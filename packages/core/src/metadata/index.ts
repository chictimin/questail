/**
 * 게임 메타 조회 — Steam appdetails 승격 (postie src/collect/steam.ts).
 *
 * 레이트리밋 정책 (hcom 리서치 실측 반영):
 * - appdetails는 비공식 API. 약 200req/5min 상한, 220번째 부근 429,
 *   계속 밀면 403으로 악화, 이후 5분 대기 필요.
 * - Promise.all 전량 병렬 호출 금지. fetchAppMeta 자체가 요청 간격
 *   2초(내부 상수 + 테스트 주입만)를 강제하므로 호출 측은 단순 for
 *   순회만 하면 된다. fetchAppMetaBatch가 그 순회 본보기다.
 * - HTTP 429/403 또는 연속 success:false(기본 5회)가 뜨면 5분 쿨다운에
 *   들어가고 AppMetaRateLimitedError를 던진다. 호출자가 식별해 중단한다.
 *   자동 백오프·재시도·같은 appId 재호출은 없다(v1.5.2).
 *
 * 디스크 캐시: 명시 cacheDir 아래 `<appid>.<locale>.json` (스키마 v3).
 * v3은 단일 locale 원문을 그대로 보존하고, 호출자에게는 파생한 GameMeta를
 * 반환한다. 파생 규칙이 바뀌면 재수집 없이 캐시 raw에서 다시 파생할 수 있다.
 * 캐시는 라이브러리 코드가 아니라 실행 시점 프로젝트의 런타임 데이터라
 * packages/core 안에 두지 않는다. 호출 측이 cacheDir을 명시 전달한다.
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

const STORE_API_BASE = 'https://store.steampowered.com';
const APPDETAILS_PATH = '/api/appdetails';
const FETCH_TIMEOUT_MS = 15_000;

/** 요청 간격. D-07 기본 2초 + 설정으로 대체됐다. */
/** 429·403·연속 success:false 시 쿨다운 5분 */
const COOLDOWN_MS = 5 * 60 * 1_000;
/** success:false가 이 횟수 연속이면 레이트리밋으로 간주하고 쿨다운 */
const SOFT_FAIL_THRESHOLD = 5;

// ─── 레이트리밋 상태 (모듈 스코프 — 프로세스 내 전역으로 간격 보장) ──

let lastRequestAt = 0;
let cooldownUntil = 0;
let consecutiveSoftFail = 0;

/** 쿨다운 진입 중 — 호출자가 식별해 중단한다. 자동 재개하지 않는다. */
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

/**
 * 캐시 스키마 버전. v2부터 파싱된 GameMeta가 아니라 appdetails 원문
 * (raw en+ko)을 보존한다. 버전을 올리면 예전 포맷 캐시가 전부
 * 스테일로 처리되므로 파일을 지우는 코드를 따로 쓰지 않는다.
 * v·fetchedAt·notFound·raw는 디스크에만 있고 GameMeta 타입에는 속하지 않는다.
 * P-9: 캐시 키는 (appId, 언어)다. 파일명은 `<appid>.<locale>.json`이다.
 */
const META_CACHE_VERSION = 3;

/** 디스크 캐시 1건 (v3). 키는 (appId, 언어)다. raw는 단일 locale 원문이다. */
interface AppMetaCacheV3 {
  v: number;
  appId: string;
  locale: 'en' | 'ko';
  fetchedAt: number;
  /** success:false 확정 실패면 true, raw는 null */
  notFound: boolean;
  raw: unknown;
}

function cacheFileName(appId: string, locale: 'en' | 'ko'): string {
  return `${appId}.${locale}.json`;
}

async function readCache(
  cacheDir: string,
  appId: string,
  locale: 'en' | 'ko',
): Promise<{ meta: GameMeta; state: MetaSourceState } | undefined> {
  try {
    const rawText = await readFile(join(cacheDir, cacheFileName(appId, locale)), 'utf-8');
    const parsed = JSON.parse(rawText) as Partial<AppMetaCacheV3>;
    if (parsed?.appId !== appId || parsed?.locale !== locale) return undefined;
    if (parsed.v !== META_CACHE_VERSION) return undefined; // 구버전 → 다시 받는다
    if (parsed.notFound) return { meta: fallbackMeta(appId), state: 'failed' as const };
    const data = (parsed.raw ?? null) as AppDetailsData | null;
    const meta = deriveForLocale(data, locale, appId);
    return { meta, state: meta.name ? ('ready' as const) : ('empty' as const) };
  } catch {
    return undefined;
  }
}

async function writeCache(
  cacheDir: string,
  entry: { appId: string; locale: 'en' | 'ko'; fetchedAt: number; notFound: boolean; raw: unknown },
): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      join(cacheDir, cacheFileName(entry.appId, entry.locale)),
      JSON.stringify({ v: META_CACHE_VERSION, ...entry }),
      'utf-8',
    );
  } catch {
    // 캐시 기록 실패는 치명적이지 않음 — API 결과는 그대로 반환
  }
}

// ─── appdetails 파싱 ─────────────────────────────────────────

/** appdetails data 원문. 캐시 raw에 그대로 보존되는 대상이다. */
export interface AppDetailsData {
  name?: string;
  platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
  genres?: Array<{ id?: string | number; description?: string }>;
  categories?: Array<{ id?: string | number; description?: string }>;
  developers?: string[];
  publishers?: string[];
  release_date?: { coming_soon?: boolean; date?: string };
  header_image?: string;
  capsule_imagev5?: string;
  capsule_image?: string;
}

interface AppDetailsRaw {
  success: boolean;
  data?: AppDetailsData;
}

type AppDetailsEnvelope = Record<string, AppDetailsRaw | undefined>;

/**
 * 장르가 아닌 Steam 분류 제외 목록 — 언어와 무관한 숫자 id 기준.
 * description 문자열로 거르면 로케일마다 달라지므로(en 정본 + ko 별도 호출)
 * 반드시 id로 판정한다. id가 없으면(구 API 응답 등) 걸러내지 않는다.
 *
 * 실측 기록 (appdetails raw 응답에서 직접 확인):
 *   70 = Early Access (앞서 해보기) — Project Zomboid 108600 등
 *   37 = Free to Play (무료 플레이) — Destiny 2 1085660, Unturned 304930
 *   57 = Utilities (유틸리티) — 3DMark 223850
 * 남긴 것: Massively Multiplayer(대규모 멀티플레이어)는 정당한 장르라 제외 안 함.
 *
 * 의도적으로 안 넣은 것:
 * - 콘텐츠 표시(Violent·Gore·Nudity 등)는 genres[]가 아니라 응답의
 *   content_descriptors에 들어 있어서 파서가 읽지 않는다. 걸러낼 게 없다.
 * - Demo·소프트웨어 카테고리 id는 라이브러리에 해당 게임이 없어 실측
 *   불가라 넣지 않았다. id 추측 금지 — 추가하려면 appdetails raw에서
 *   id를 확인한 뒤 여기에 한 줄씩 추가해라.
 */
const EXCLUDED_GENRE_IDS = new Set<string>([
  '70', // Early Access
  '37', // Free to Play
  '57', // Utilities
]);

function fallbackMeta(appId: string): GameMeta {
  return { appId, genres: [] };
}

/**
 * 단일 locale 원문 → GameMeta 파생 (P-9).
 * titleKo·nameKo·장르 nameKo는 locale ko일 때만 채운다.
 * cover는 capsule_imagev5 → capsule_image → header_image 순서다.
 * en 응답에 한국어값이 섞여 있어도 ko가 아니면 채우지 않는다.
 */
export function deriveForLocale(
  raw: AppDetailsData | null,
  locale: 'en' | 'ko',
  appId: string,
): GameMeta {
  if (!raw) return fallbackMeta(appId);
  const isKo = locale === 'ko';
  const genres = (raw.genres ?? [])
    .filter(g => g.id === undefined || !EXCLUDED_GENRE_IDS.has(String(g.id)))
    .map(g => {
      const id = g.id !== undefined ? String(g.id) : '';
      const name = g.description ?? '';
      const koDesc = isKo ? name : '';
      return {
        id,
        name,
        nameKo: isKo && koDesc.length > 0 && /[가-힣]/.test(koDesc) ? koDesc : null,
      };
    })
    .filter(g => g.name.length > 0);

  const koName = isKo ? raw.name : undefined;
  const nameKo = koName && /[가-힣]/.test(koName) ? koName : undefined;

  const releaseDateRaw = raw.release_date?.date;
  const releaseDate = toIsoDate(releaseDateRaw);
  const cover = raw.capsule_imagev5 ?? raw.capsule_image ?? raw.header_image;

  const meta: GameMeta = {
    appId,
    name: raw.name,
    platforms: (['windows', 'mac', 'linux'] as const).filter(p => raw.platforms?.[p] === true),
    genres,
    developers: (raw.developers ?? []).filter(s => s.length > 0),
    publishers: (raw.publishers ?? []).filter(s => s.length > 0),
    headerImage: cover,
    categoryAxes: {
      playMode: axisValues(raw.categories, PLAY_MODE_IDS),
      input: axisValues(raw.categories, INPUT_IDS),
      device: axisValues(raw.categories, DEVICE_IDS),
    },
  };
  if (nameKo !== undefined) meta.nameKo = nameKo;
  if (releaseDate !== undefined) meta.releaseDate = releaseDate;
  if (releaseDateRaw !== undefined) meta.releaseDateRaw = releaseDateRaw;
  return meta;
}

/**
 * ko 응답에서 같은 id 장르의 한국어 표기를 찾는다.
 * 없거나 비어 있거나 영어와 같으면 null이다(ko 장르 없음).
 * 순서는 en 기준을 유지한다(ko 순서 차이 무시).
 */
function genreNameKo(id: string, ko: AppDetailsData | null): string | null {
  if (!ko || id.length === 0) return null;
  const found = (ko.genres ?? []).find(g => g.id !== undefined && String(g.id) === id);
  const desc = found?.description ?? '';
  if (desc.length === 0) return null;
  return desc;
}
const EN_MONTH_NUMBERS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
};

/**
 * 영어 월 약어 → 월 번호. 영국식 "26 Feb, 2016"의 ISO 변환용.
 * P2 실측 116건에서 출현한 12종 표준 약어만 둔다. 실측 없는 표기는 넣지 않는다.
 */
const EN_MONTH_ABBR_NUMBERS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04',
  may: '05', jun: '06', jul: '07', aug: '08',
  sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * en 응답 날짜 문자열 → ISO(YYYY-MM-DD). 실측된 두 형식만 변환한다:
 * 미국식 "<월명> D, YYYY"와 영국식 "D <월 약어>, YYYY".
 * 빈 문자열·월만 있거나 "Coming soon" 같은 값은 undefined를 반환하고
 * 호출 측이 releaseDate를 비운 채 releaseDateRaw만 채운다.
 */
function toIsoDate(enDate?: string): string | undefined {
  if (!enDate) return undefined;
  const us = /^\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*$/.exec(enDate);
  if (us) {
    // 풀네임 우선, 실측된 약어("Jul 7, 2017")도 받는다. 둘 다 실측 범위 안이다.
    const mon = EN_MONTH_NUMBERS[us[1].toLowerCase()] ?? EN_MONTH_ABBR_NUMBERS[us[1].toLowerCase()];
    if (!mon) return undefined;
    const day = Number(us[2]);
    if (day < 1 || day > 31) return undefined;
    return `${us[3]}-${mon}-${String(day).padStart(2, '0')}`;
  }
  const uk = /^\s*(\d{1,2})\s+([A-Za-z]+),\s*(\d{4})\s*$/.exec(enDate);
  if (uk) {
    const mon = EN_MONTH_ABBR_NUMBERS[uk[2].toLowerCase()];
    if (!mon) return undefined;
    const day = Number(uk[1]);
    if (day < 1 || day > 31) return undefined;
    return `${uk[3]}-${mon}-${String(day).padStart(2, '0')}`;
  }
  return undefined;
}

/**
 * categories 3축 사전 (D11, P2 실측 확정). 판정은 반드시 id 기준 —
 * description 문자열로 거르면 안 된다(55/56·57/58이 바이트 동일 description을 쓴다).
 * 축에 속하지 않는 관측 id는 파생에서 버리고 raw에만 남긴다.
 */
const PLAY_MODE_IDS = new Set<string>([
  '1', '2', '9', '20', '24', '27', '36', '37', '38', '39', '44', '47', '48', '49',
]);

const INPUT_IDS = new Set<string>([
  '18', '28', '31', '52', '53', '55', '56', '57', '58', '59', '60', '75', '76', '77',
]);

const DEVICE_IDS = new Set<string>(['23', '41', '42', '43', '61']);

/**
 * 축 id 집합에 속한 categories의 영어 description을 순서대로 모은다.
 * 동일 description이 한 게임에 함께 있으면(55/56, 57/58) 중복 제거한다.
 * description이 없는 항목은 파생할 문자열이 없으므로 버린다.
 */
function axisValues(
  categories: AppDetailsData['categories'],
  ids: Set<string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of categories ?? []) {
    if (c.id === undefined || !ids.has(String(c.id))) continue;
    const name = c.description ?? '';
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * 캐시 raw(en+ko 원문) → GameMeta 파생. 재수집 없이 파생만 다시
 * 돌릴 수 있도록 fetchAppMeta와 분리되어 있다.
 * categoryAxes는 P2 축 사전으로 채운다. en이 없으면 폴백이라 축도 없다.
 */
export function deriveGameMeta(
  raw: { en: AppDetailsData | null; ko: AppDetailsData | null },
  appId: string,
): GameMeta {
  const en = raw.en;
  if (!en) return fallbackMeta(appId);

  const genres = (en.genres ?? [])
    .filter(g => g.id === undefined || !EXCLUDED_GENRE_IDS.has(String(g.id)))
    .map(g => ({
      id: g.id !== undefined ? String(g.id) : '',
      name: g.description ?? '',
      nameKo: genreNameKo(g.id !== undefined ? String(g.id) : '', raw.ko),
    }))
    .filter(g => g.name.length > 0);

  // ko 응답 name에 한글이 실제로 있을 때만 nameKo를 채운다.
  // Steam이 번역을 빠뜨려 영어를 그대로 주는 경우가 많다.
  const koName = raw.ko?.name;
  const nameKo = koName && /[가-힣]/.test(koName) ? koName : undefined;

  const releaseDateRaw = en.release_date?.date;
  const releaseDate = toIsoDate(releaseDateRaw);

  const meta: GameMeta = {
    appId,
    name: en.name,
    platforms: (['windows', 'mac', 'linux'] as const).filter(p => en.platforms?.[p] === true),
    genres,
    developers: (en.developers ?? []).filter(s => s.length > 0),
    publishers: (en.publishers ?? []).filter(s => s.length > 0),
    headerImage: en.header_image,
    categoryAxes: {
      playMode: axisValues(en.categories, PLAY_MODE_IDS),
      input: axisValues(en.categories, INPUT_IDS),
      device: axisValues(en.categories, DEVICE_IDS),
    },
  };
  if (nameKo !== undefined) meta.nameKo = nameKo;
  if (releaseDate !== undefined) meta.releaseDate = releaseDate;
  if (releaseDateRaw !== undefined) meta.releaseDateRaw = releaseDateRaw;
  return meta;
}

// ─── 공개 API (시그니처 고정 — fetchAppMeta(appId: string)) ──

/** 캐시 디렉터리명. 데이터 디렉터리 아래에 둔다. 웹 run.ts가 조립해 주입한다. */
export const META_CACHE_DIR_NAME = 'meta';

/** SteamSpy 캐시 디렉터리명. meta 캐시의 형제(dataDir/steamspy)로 둔다. */
export const STEAMSPY_CACHE_DIR_NAME = 'steamspy';

/** 요청 간격 기본 2초 (D-07). 설정으로 바꾼다. */
const DEFAULT_INTERVAL_MS = 2_000;

/**
 * 메타 조회 옵션 (D-07).
 * cacheDir은 명시 인자다(env·cwd 해석 없음). 없으면 기존 resolve(호환).
 * intervalMs 기본 2000 — 테스트 전용 주입이며 설정과 연계하지 않는다(P-9).
 * locale 기본 'en'. fetchFn·now·sleepFn 주입 시 가짜 fetch·clock 테스트가
 * 된다. bypassCache는 사용자 새로받기용.
 */
export interface MetaFetchOptions {
  cacheDir?: string;
  intervalMs?: number;
  locale?: 'en' | 'ko';
  fetchFn?: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
  now?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  bypassCache?: boolean;
  /** 테스트 base. 없으면 공식 store. 뒤에 /api/appdetails를 붙인다. */
  baseUrl?: string;
}

/** 원천 상태. not_collected는 호출 측(미시도)이라 함수 밖에서 다룬다. */
export type MetaSourceState = 'ready' | 'empty' | 'failed';

export interface MetaFetchResult {
  meta: GameMeta;
  state: MetaSourceState;
  fromCache: boolean;
}

interface ResolvedMetaOptions {
  cacheDir: string;
  intervalMs: number;
  locale: 'en' | 'ko';
  fetchFn: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
  now: () => number;
  sleepFn: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  bypassCache: boolean;
  baseUrl: string;
}

function resolveMetaOptions(options?: MetaFetchOptions): ResolvedMetaOptions {
  return {
    cacheDir: options?.cacheDir ?? resolveAppMetaCacheDir(),
    intervalMs: options?.intervalMs ?? DEFAULT_INTERVAL_MS,
    locale: options?.locale ?? 'en',
    fetchFn: options?.fetchFn ?? ((url, init) => fetch(url, init)),
    now: options?.now ?? Date.now,
    sleepFn: options?.sleepFn ?? sleep,
    signal: options?.signal,
    bypassCache: options?.bypassCache ?? false,
    baseUrl: (options?.baseUrl ?? STORE_API_BASE).replace(/\/+$/, ''),
  };
}

/**
 * 쿨다운 확인 → 간격 강제 → fetch 1회.
 * 쿨다운 중이면 AppMetaRateLimitedError를 던진다.
 */
async function throttledFetch(
  url: string,
  cfg: ResolvedMetaOptions,
  signal?: AbortSignal,
): Promise<Response> {
  const now = cfg.now();
  if (now < cooldownUntil) {
    throw new AppMetaRateLimitedError(cooldownUntil - now);
  }

  const elapsed = now - lastRequestAt;
  if (elapsed < cfg.intervalMs) {
    await cfg.sleepFn(cfg.intervalMs - elapsed);
  }
  lastRequestAt = cfg.now();

  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('aborted');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const onExternalAbort = (): void => {
    ctrl.abort();
  };
  if (signal) {
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    return await cfg.fetchFn(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

function enterCooldown(now: number): void {
  cooldownUntil = now + COOLDOWN_MS;
}

/**
 * 게임 1건의 메타 조회. 캐시 hit면 API 호출 없이 raw에서 파생해 반환한다.
 * 단일 locale 1요청만 한다(P-9). 시그니처와 반환 타입(Promise<GameMeta>)은
 * 바꾸지 않는다. 간격 기본은 D-07에 따라 2초이다.
 */
export async function fetchAppMeta(appId: string, options?: MetaFetchOptions): Promise<GameMeta> {
  return (await fetchAppMetaStatus(appId, options)).meta;
}

function linkAbort(signal: AbortSignal | undefined): {
  signal: AbortSignal | undefined;
  unlink: () => void;
} {
  if (!signal) return { signal: undefined, unlink: () => undefined };
  const ctrl = new AbortController();
  if (signal.aborted) {
    ctrl.abort();
    return { signal: ctrl.signal, unlink: () => undefined };
  }
  const onAbort = (): void => {
    ctrl.abort();
  };
  signal.addEventListener('abort', onAbort, { once: true });
  return { signal: ctrl.signal, unlink: () => signal.removeEventListener('abort', onAbort) };
}

/**
 * 상태付き 메타 조회 (D-07 + P-9).
 * 단일 locale 1요청(`l=english|koreana`)만 한다. titleKo·nameKo·장르
 * nameKo는 locale ko일 때만 채운다. cover는 capsule_imagev5 →
 * capsule_image → header_image 순서다.
 * ready = 데이터+이름 있음. empty = 데이터는 있으나 이름 없음.
 * failed = 확정 실패(success:false, 캐시함) 또는 일시 실패(폴백, 캐시 안 함).
 * 외부 abort는 전파한다(폴백으로 삼키지 않는다). 429·403은 즉시 중단하고
 * AppMetaRateLimitedError를 던진다(자동 백오프·재시도 없음, v1.5.2).
 */
export async function fetchAppMetaStatus(
  appId: string,
  options?: MetaFetchOptions,
): Promise<MetaFetchResult> {
  if (!/^\d+$/.test(appId)) {
    throw new Error(`유효하지 않은 appId: ${appId}`);
  }
  const cfg = resolveMetaOptions(options);
  const cacheDir = cfg.cacheDir;
  const locale = cfg.locale;
  const langParam = locale === 'ko' ? 'koreana' : 'english';

  if (!cfg.bypassCache) {
    const cached = await readCache(cacheDir, appId, locale);
    if (cached) return { ...cached, fromCache: true };
  }

  const linked = linkAbort(cfg.signal);
  try {
    let res: Response;
    try {
      res = await throttledFetch(`${cfg.baseUrl}${APPDETAILS_PATH}?appids=${appId}&l=${langParam}`, cfg, linked.signal);
    } catch (e) {
      if (e instanceof AppMetaRateLimitedError) throw e;
      if (linked.signal?.aborted) throw e;
      return { meta: fallbackMeta(appId), state: 'failed', fromCache: false };
    }

    if (res.status === 429 || res.status === 403) {
      enterCooldown(cfg.now());
      throw new AppMetaRateLimitedError(COOLDOWN_MS);
    }
    if (!res.ok) {
      return { meta: fallbackMeta(appId), state: 'failed', fromCache: false };
    }

    let envelope: AppDetailsEnvelope;
    try {
      envelope = (await res.json()) as AppDetailsEnvelope;
    } catch {
      return { meta: fallbackMeta(appId), state: 'failed', fromCache: false };
    }

    const entry = envelope[appId];
    if (!entry?.success || !entry.data) {
      consecutiveSoftFail += 1;
      await writeCache(cacheDir, { appId, locale, fetchedAt: cfg.now(), notFound: true, raw: null });
      if (consecutiveSoftFail >= SOFT_FAIL_THRESHOLD) {
        consecutiveSoftFail = 0;
        enterCooldown(cfg.now());
      }
      return { meta: fallbackMeta(appId), state: 'failed', fromCache: false };
    }

    consecutiveSoftFail = 0;
    const raw: AppDetailsData = entry.data;
    await writeCache(cacheDir, { appId, locale, fetchedAt: cfg.now(), notFound: false, raw });
    const meta = deriveForLocale(raw, locale, appId);
    return { meta, state: meta.name ? 'ready' : 'empty', fromCache: false };
  } finally {
    linked.unlink();
  }
}

/**
 * fetchAppMetaBatch 호출 옵션.
 */
export interface FetchAppMetaBatchOptions {
  onProgress?: (done: number, total: number, appId: string) => void;
  /**
   * 레이트리밋(429/403 또는 연속 소프트실패) 시 동작.
   * 'throw' — 즉시 중단하고 에러를 던진다. 호출자가 instanceof로
   *   RATE_LIMITED를 식별한다 (기본값, v1.5.2. 자동 백오프·재시도 없음).
   * 'stop' — 즉시 중단하고 그때까지 모은 결과만 반환한다. 지연 회피 우선.
   *   'wait' 값은 과거 호환용으로 'throw'와 같다(대기 후 재개하지 않는다).
   */
  onRateLimit?: 'throw' | 'wait' | 'stop';
  /** 테스트·호출 측 주입. fetchAppMeta 옵션 그대로 전달한다. */
  fetchFn?: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
  cacheDir?: string;
  locale?: 'en' | 'ko';
  bypassCache?: boolean;
  now?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

/**
 * 전수 조회용 순차 배치. Promise.all을 쓰지 않는다 — 1건씩 for 순회하며
 * fetchAppMeta 내부 스로틀이 간격을 보장한다. 쿨다운 에러가 나면
 * 즉시 중단한다('throw' 기본값 — throw하거나, 'stop'이면 그때까지 모은
 * 결과만 반환한다). 같은 appId 자동 재호출은 하지 않는다(v1.5.2).
 */
export async function fetchAppMetaBatch(
  appIds: string[],
  options?: FetchAppMetaBatchOptions,
): Promise<GameMeta[]> {
  const out: GameMeta[] = [];
  const childOptions =
    options?.fetchFn !== undefined ||
    options?.cacheDir !== undefined ||
    options?.locale !== undefined ||
    options?.bypassCache !== undefined ||
    options?.now !== undefined ||
    options?.sleepFn !== undefined ||
    options?.signal !== undefined
      ? {
          fetchFn: options.fetchFn,
          cacheDir: options.cacheDir,
          locale: options.locale,
          bypassCache: options.bypassCache,
          now: options.now,
          sleepFn: options.sleepFn,
          signal: options.signal,
        }
      : undefined;
  for (let i = 0; i < appIds.length; i++) {
    const id = appIds[i];
    try {
      out.push(await fetchAppMeta(id, childOptions));
    } catch (e) {
      if (e instanceof AppMetaRateLimitedError) {
        if (options?.onRateLimit === 'stop') break;
        throw e;
      } else {
        throw e;
      }
    }
    options?.onProgress?.(i + 1, appIds.length, id);
  }
  return out;
}
