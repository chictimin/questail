/**
 * SteamSpy 커넥터 — 유저 태그 수집 (D-17, A 소유).
 *
 * 엔드포인트: https://steamspy.com/api.php?request=appdetails&appid=<id>
 * 응답의 tags 객체({태그명: 투표수})를 투표 수 내림차순 상위 10개로 잘라 반환한다.
 *
 * 결과는 ready/empty/failed union이다. 실패·손상은 failed이며 DB 태그를
 * 보존하는 쪽(D-06 job)에서 구분한다. 실패·손상 시 캐시에 쓰지 않는다.
 *
 * 레이트리밋: 1req/sec, SteamSpy 전용 limiter(appdetails와 별도). 기본
 * 모듈 limiter를 쓰며 주입으로 교체·가짜 clock 측정이 가능하다.
 *
 * 디스크 캐시: 명시 cacheDir 인자 아래 `<appid>.json`,
 * 스키마 {v, appId, fetchedAt, raw}. raw는 가공 없이 그대로 보존한다.
 * core 함수는 env·cwd를 읽지 않는다. namespace 상수는 두지 않는다(P-10 미결).
 * SteamSpy 응답을 픽스처로 커밋하지 않는다 (D10 라이선스 위험 회피) —
 * 테스트는 합성 데이터를 넣어 한다.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const STEAMSPY_BASE = 'https://steamspy.com/api.php';
const FETCH_TIMEOUT_MS = 15_000;

/** SteamSpy 상한 — 1req/sec */
const REQUEST_INTERVAL_MS = 1_000;

/** 캐시 스키마 버전. raw 보존 형식이 바뀌면 올린다 */
const STEAMSPY_CACHE_VERSION = 1;

/** 응답 tags에서 상위 몇 개를 취하는가 */
const TOP_TAG_COUNT = 10;

// ─── 타입 ───

export interface SteamSpyUserTag {
  tag: string;
  votes: number;
}

export interface SteamSpyCacheEntry {
  v: number;
  appId: string;
  fetchedAt: number;
  raw: unknown;
}

/** 태그 수집 상태. failed는 기존 DB 태그 보존 신호다. */
export type SteamSpyTagStatus = 'ready' | 'empty' | 'failed';

export type SteamSpyTagsResult =
  | { status: 'ready'; tags: SteamSpyUserTag[] }
  | { status: 'empty'; tags: [] }
  | { status: 'failed'; tags: [] };

export type SteamSpyFetchFn = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

/** 가짜 clock 주입점. sleep은 clock을 전진시켜야 한다. */
export interface SteamSpyClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** SteamSpy 전용 limiter 상태. appdetails limiter와 별도다. */
export interface SteamSpyLimiter {
  lastRequestAt: number;
}

export function createSteamSpyLimiter(): SteamSpyLimiter {
  return { lastRequestAt: 0 };
}

export interface SteamSpyFetchOptions {
  appId: string;
  /** 명시 캐시 디렉터리. env·cwd 해석 없음. namespace 상수 없음(P-10 미결). */
  cacheDir: string;
  /** 빈 태그 재수집용. true면 읽기만 건너뛰고 성공 시 새로 쓴다. */
  bypassCache?: boolean;
  signal?: AbortSignal;
  fetchFn?: SteamSpyFetchFn;
  clock?: SteamSpyClock;
  limiter?: SteamSpyLimiter;
}

const defaultClock: SteamSpyClock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
};

const defaultLimiter = createSteamSpyLimiter();

// ─── 디스크 캐시 ───

/**
 * 캐시 루트 결정 (보관: 구 CLI 경로. core 수집 함수는 직접 읽지 않는다).
 * QUESTAIL_CACHE_DIR이 있으면 그 아래 steamspy, 없으면 cwd 아래 .cache/steamspy.
 */
export function resolveSteamSpyCacheDir(): string {
  const override = process.env.QUESTAIL_CACHE_DIR?.trim();
  if (override) return join(resolve(override), 'steamspy');
  return join(resolve('.cache'), 'steamspy');
}

function cacheFilePath(cacheDir: string, appId: string): string {
  return join(cacheDir, `${appId}.json`);
}

/** 적중 시 raw, 빗나감·손상 시 undefined(손상은 miss로 보고 재요청한다). */
async function readCache(cacheDir: string, appId: string): Promise<unknown | undefined> {
  try {
    const text = await readFile(cacheFilePath(cacheDir, appId), 'utf-8');
    const parsed = JSON.parse(text) as SteamSpyCacheEntry;
    if (parsed?.appId !== appId) return undefined;
    if (parsed.v !== STEAMSPY_CACHE_VERSION) return undefined; // 구버전 → 다시 받는다
    return parsed.raw;
  } catch {
    return undefined;
  }
}

/** 성공 raw만 쓴다. 실패·손상은 호출 측에서 부르지 않는다. */
async function writeCache(cacheDir: string, appId: string, raw: unknown): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
    const entry: SteamSpyCacheEntry = {
      v: STEAMSPY_CACHE_VERSION,
      appId,
      fetchedAt: Date.now(),
      raw,
    };
    await writeFile(cacheFilePath(cacheDir, appId), JSON.stringify(entry), 'utf-8');
  } catch {
    // 캐시 기록 실패는 치명적이지 않음 — 수집 결과는 그대로 반환
  }
}

// ─── 파생 (순수 함수 — 합성 데이터로 테스트한다, 실응답 커밋 금지) ───

/**
 * SteamSpy appdetails 응답 raw에서 유저 태그 상위 10개를 뽑는다.
 * 투표 수 내림차순, 동점이면 태그명 오름차순(코드포인트 순서, 재현성)으로 안정 정렬.
 * tags가 없거나 깨졌으면 빈 배열 — throw하지 않는다 (기존 동작 유지).
 */
export function deriveSteamSpyUserTags(raw: unknown): SteamSpyUserTag[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const tags = (raw as { tags?: unknown }).tags;
  if (typeof tags !== 'object' || tags === null || Array.isArray(tags)) return [];
  const entries: SteamSpyUserTag[] = [];
  for (const [tag, votes] of Object.entries(tags)) {
    if (tag.length === 0) continue;
    if (typeof votes !== 'number' || !Number.isFinite(votes)) continue;
    entries.push({ tag, votes });
  }
  entries.sort(
    (a, b) => b.votes - a.votes || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0),
  );
  return entries.slice(0, TOP_TAG_COUNT);
}

type ClassifiedTags =
  | { kind: 'ready'; tags: SteamSpyUserTag[] }
  | { kind: 'empty' }
  | { kind: 'corrupt' };

/** raw 분류. corrupt는 failed 신호, empty는 저장 대상 상태다. */
function classifyUserTags(raw: unknown): ClassifiedTags {
  if (typeof raw !== 'object' || raw === null) return { kind: 'corrupt' };
  const tags = (raw as { tags?: unknown }).tags;
  if (typeof tags !== 'object' || tags === null || Array.isArray(tags)) {
    return { kind: 'corrupt' };
  }
  const derived = deriveSteamSpyUserTags(raw);
  return derived.length > 0 ? { kind: 'ready', tags: derived } : { kind: 'empty' };
}

async function pace(limiter: SteamSpyLimiter, clock: SteamSpyClock): Promise<void> {
  const elapsed = clock.now() - limiter.lastRequestAt;
  if (elapsed < REQUEST_INTERVAL_MS) {
    await clock.sleep(REQUEST_INTERVAL_MS - elapsed);
  }
  limiter.lastRequestAt = clock.now();
}

// ─── 공개 API ───

/**
 * 게임 1건의 SteamSpy 유저 태그 조회 (D-17).
 * 캐시 적중이면 API 호출 없이 분류만 반환한다. 호출 전 1초 간격을 강제한다.
 * 네트워크·타임아웃·비정상 응답·파싱 실패는 failed를 반환하고 throw하지 않는다.
 * 실패·손상은 캐시에 쓰지 않는다. 빈 태그는 empty이며 성공 raw는 캐시한다.
 */
export async function fetchSteamSpyUserTags(
  opts: SteamSpyFetchOptions,
): Promise<SteamSpyTagsResult> {
  const failed: SteamSpyTagsResult = { status: 'failed', tags: [] };
  // 계약 미정의, 리드 지시 제안: 숫자 아닌 appId는 요청 없이 failed.
  if (!/^\d+$/.test(opts.appId)) return failed;
  const clock = opts.clock ?? defaultClock;
  const limiter = opts.limiter ?? defaultLimiter;
  const fetchFn = opts.fetchFn ?? fetch;
  if (opts.signal?.aborted) return failed;
  if (!opts.bypassCache) {
    const cached = await readCache(opts.cacheDir, opts.appId);
    if (cached !== undefined) {
      const hit = classifyUserTags(cached);
      if (hit.kind === 'ready') return { status: 'ready', tags: hit.tags };
      if (hit.kind === 'empty') return { status: 'empty', tags: [] };
      // corrupt → miss로 보고 재요청한다
    }
  }
  await pace(limiter, clock);
  if (opts.signal?.aborted) return failed;
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
    : AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let res: { status: number; json: () => Promise<unknown> };
  try {
    res = await fetchFn(`${STEAMSPY_BASE}?request=appdetails&appid=${opts.appId}`, { signal });
  } catch {
    return failed;
  }
  if (res.status !== 200) return failed; // 일시 오류는 캐시하지 않는다
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return failed;
  }
  const classified = classifyUserTags(raw);
  if (classified.kind === 'corrupt') return failed; // 손상 시 캐시 쓰기 금지
  await writeCache(opts.cacheDir, opts.appId, raw);
  return classified.kind === 'ready'
    ? { status: 'ready', tags: classified.tags }
    : { status: 'empty', tags: [] };
}
