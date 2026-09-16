/**
 * 게임 메타 조회 — Steam appdetails 승격 (postie src/collect/steam.ts).
 *
 * 레이트리밋 정책 (hcom 리서치 실측 반영):
 * - appdetails는 비공식 API. 약 200req/5min 상한, 220번째 부근 429,
 *   계속 밀면 403으로 악화, 이후 5분 대기 필요.
 * - Promise.all 전량 병렬 호출 금지. fetchAppMeta 자체가 요청 간격
 *   1.5초를 강제하므로 호출 측은 단순 for 순회만 하면 된다
 *   (118건 ≈ 3분). fetchAppMetaBatch가 그 순회 본보기다.
 * - HTTP 429/403 또는 연속 success:false(기본 5회)가 뜨면 5분 쿨다운에
 *   들어가고 AppMetaRateLimitedError를 던진다. 배치 호출자는 대기 후
 *   같은 appId부터 재개하면 된다.
 *
 * 디스크 캐시: <프로젝트 루트>/.cache/appdetails/<appid>.json.
 * packages/core 안에 두지 않는다 — 캐시는 라이브러리 코드가 아니라
 * 실행 시점 프로젝트의 런타임 데이터이기 때문이다.
 * QUESTAIL_CACHE_DIR 환경변수로 루트 변경 가능 (기본값: process.cwd()).
 *
 * postie와의 차이:
 * - postie metaCache는 프로세스 메모리라 매 실행마다 소멸 → 디스크 캐시로 변경.
 * - postie는 모든 실패 경로를 캐시 → 여기서는 확정 실패(success:false,
 *   해당 appId가 스토어에 없음)만 캐시하고, 일시 오류(네트워크·5xx)는
 *   캐시하지 않고 폴백만 반환한다. 디스크 캐시는 실행을 넘어 살아남으므로
 *   일시 오류까지 굳히면 다음 실행도 오염되기 때문이다.
 * - postie가 버리던 developers·publishers·release_date·header_image 추가 파싱.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { GameMeta } from '../types.js';

const APPDETAILS_BASE = 'https://store.steampowered.com/api/appdetails';
const FETCH_TIMEOUT_MS = 15_000;

/** 요청 간격 1.5초 — 118건 전수 ≈ 3분, 200req/5min 상한 안쪽 */
const REQUEST_INTERVAL_MS = 1_500;
/** 429·403·연속 success:false 시 쿨다운 5분 */
const COOLDOWN_MS = 5 * 60 * 1_000;
/** success:false가 이 횟수 연속이면 레이트리밋으로 간주하고 쿨다운 */
const SOFT_FAIL_THRESHOLD = 5;

// ─── 레이트리밋 상태 (모듈 스코프 — 프로세스 내 전역으로 간격 보장) ──

let lastRequestAt = 0;
let cooldownUntil = 0;
let consecutiveSoftFail = 0;

/** 쿨다운 진입 중 — retryAfterMs 뒤 같은 appId부터 재개하면 된다 */
export class AppMetaRateLimitedError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`Steam appdetails rate limit. ${Math.ceil(retryAfterMs / 1000)}초 후 재개하세요.`);
    this.name = 'AppMetaRateLimitedError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── 디스크 캐시 ─────────────────────────────────────────────

/**
 * 캐시 루트 결정. QUESTAIL_CACHE_DIR이 있으면 그 아래 appdetails,
 * 없으면 실행 시점 cwd(= questail 프로젝트 루트) 아래 .cache/appdetails.
 */
export function resolveAppMetaCacheDir(): string {
  const override = process.env.QUESTAIL_CACHE_DIR?.trim();
  if (override) return join(resolve(override), 'appdetails');
  return join(resolve('.cache'), 'appdetails');
}

function cachePath(appId: string): string {
  return join(resolveAppMetaCacheDir(), `${appId}.json`);
}

async function readCache(appId: string): Promise<GameMeta | undefined> {
  try {
    const raw = await readFile(cachePath(appId), 'utf-8');
    const parsed = JSON.parse(raw) as GameMeta;
    if (parsed?.appId === appId) return parsed;
    return undefined;
  } catch {
    return undefined;
  }
}

async function writeCache(meta: GameMeta): Promise<void> {
  try {
    await mkdir(resolveAppMetaCacheDir(), { recursive: true });
    await writeFile(cachePath(meta.appId), JSON.stringify(meta), 'utf-8');
  } catch {
    // 캐시 기록 실패는 치명적이지 않음 — API 결과는 그대로 반환
  }
}

// ─── appdetails 파싱 ─────────────────────────────────────────

interface AppDetailsRaw {
  success: boolean;
  data?: {
    name?: string;
    platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
    genres?: Array<{ description?: string }>;
    categories?: Array<{ description?: string }>;
    developers?: string[];
    publishers?: string[];
    release_date?: { coming_soon?: boolean; date?: string };
    header_image?: string;
  };
}

type AppDetailsEnvelope = Record<string, AppDetailsRaw | undefined>;

function descriptions(items?: Array<{ description?: string }>): string[] {
  return (items ?? []).map(i => i.description ?? '').filter(s => s.length > 0);
}

function fallbackMeta(appId: string): GameMeta {
  return { appId, genres: [], keywords: [] };
}

// ─── 공개 API (시그니처 고정 — fetchAppMeta(appId: string)) ──

/**
 * 게임 1건의 메타 조회. 캐시 히트면 API 호출 없이 반환한다.
 * 호출 전 1.5초 간격을 강제하고, 쿨다운 중이면 즉시
 * AppMetaRateLimitedError를 던진다. 일시 오류 시 빈 폴백을 반환한다.
 */
export async function fetchAppMeta(appId: string): Promise<GameMeta> {
  if (!/^\d+$/.test(appId)) {
    throw new Error(`유효하지 않은 appId: ${appId}`);
  }

  const cached = await readCache(appId);
  if (cached) return cached;

  const now = Date.now();
  if (now < cooldownUntil) {
    throw new AppMetaRateLimitedError(cooldownUntil - now);
  }

  const elapsed = now - lastRequestAt;
  if (elapsed < REQUEST_INTERVAL_MS) {
    await sleep(REQUEST_INTERVAL_MS - elapsed);
  }
  lastRequestAt = Date.now();

  let res: Response;
  try {
    res = await fetch(`${APPDETAILS_BASE}?appids=${appId}&l=korean`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return fallbackMeta(appId); // 네트워크·타임아웃: 캐시 없이 폴백
  }

  if (res.status === 429 || res.status === 403) {
    cooldownUntil = Date.now() + COOLDOWN_MS;
    throw new AppMetaRateLimitedError(COOLDOWN_MS);
  }
  if (!res.ok) {
    return fallbackMeta(appId); // 5xx 등 일시 오류: 캐시 없이 폴백
  }

  let envelope: AppDetailsEnvelope;
  try {
    envelope = (await res.json()) as AppDetailsEnvelope;
  } catch {
    return fallbackMeta(appId);
  }

  const entry = envelope[appId];
  if (!entry?.success || !entry.data) {
    consecutiveSoftFail += 1;
    const meta = fallbackMeta(appId);
    await writeCache(meta); // 확정 실패(미출시·삭제·비공개 app)는 캐시
    if (consecutiveSoftFail >= SOFT_FAIL_THRESHOLD) {
      consecutiveSoftFail = 0;
      cooldownUntil = Date.now() + COOLDOWN_MS;
      // 다음 호출부터 AppMetaRateLimitedError — 배치는 대기 후 재개
    }
    return meta;
  }

  consecutiveSoftFail = 0;
  const d = entry.data;
  const meta: GameMeta = {
    appId,
    name: d.name,
    platforms: (['windows', 'mac', 'linux'] as const).filter(p => d.platforms?.[p] === true),
    genres: descriptions(d.genres),
    developers: (d.developers ?? []).filter(s => s.length > 0),
    publishers: (d.publishers ?? []).filter(s => s.length > 0),
    releaseDate: d.release_date?.date,
    headerImage: d.header_image,
    keywords: descriptions(d.categories),
  };
  // 빈 배열·undefined는 GameMeta 선택 필드 그대로 둔다 (호출 측에서 판단)
  await writeCache(meta);
  return meta;
}

/**
 * fetchAppMetaBatch 호출 옵션.
 */
export interface FetchAppMetaBatchOptions {
  onProgress?: (done: number, total: number, appId: string) => void;
  /**
   * 레이트리밋(429/403 또는 연속 소프트실패) 시 동작.
   * 'wait' — 쿨다운만큼 기다렸다 같은 appId부터 재개. 전수 확보 우선 (기본값)
   * 'stop' — 즉시 중단하고 그때까지 모은 결과만 반환. 지연 회피 우선
   */
  onRateLimit?: 'wait' | 'stop';
}

/**
 * 전수 조회용 순차 배치. Promise.all을 쓰지 않는다 — 1건씩 for 순회하며
 * fetchAppMeta 내부 스로틀이 간격을 보장한다. 쿨다운 에러가 나면
 * onRateLimit에 따라 대기 후 같은 appId부터 재개('wait', 기본값)하거나
 * 그때까지 모은 결과만 반환하고 끝낸다('stop' — throw하지 않는다).
 */
export async function fetchAppMetaBatch(
  appIds: string[],
  options?: FetchAppMetaBatchOptions,
): Promise<GameMeta[]> {
  const onRateLimit = options?.onRateLimit ?? 'wait';
  const out: GameMeta[] = [];
  for (let i = 0; i < appIds.length; i++) {
    const id = appIds[i];
    try {
      out.push(await fetchAppMeta(id));
    } catch (e) {
      if (e instanceof AppMetaRateLimitedError) {
        if (onRateLimit === 'stop') break;
        await sleep(e.retryAfterMs);
        out.push(await fetchAppMeta(id)); // 같은 appId부터 재개
      } else {
        throw e;
      }
    }
    options?.onProgress?.(i + 1, appIds.length, id);
  }
  return out;
}
