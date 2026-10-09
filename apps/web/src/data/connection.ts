import type Database from 'better-sqlite3';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { SyncErrorCode } from '@questail/core';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { account } from '../db/schema.js';

/** 키 파일명. A가 export하고 B가 같은 상수를 import한다 (P-3). */
export const KEY_FILE_NAME = 'steam.key';

/** 제품 기본 공식 URL. README에 노출하지 않는다 (P-6). */
export const DEFAULT_STEAM_API_BASE = 'https://api.steampowered.com';

/** 공식 기본 호스트. */
const OFFICIAL_HOST = 'api.steampowered.com';

/** 테스트용 루프백 호스트. 공식 기본 외에는 이것만 허용한다 (P-6). */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * baseURL 정규화 (P-6). 스킴 http·https, 끝 slash 제거.
 * userinfo·query·fragment 있으면 null 거부. port·path 접두 허용.
 * 공식 기본이 아니면 루프백만 허용한다. 실패는 null이다.
 */
export function normalizeSteamBaseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const bracketed = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const isOfficial = host === OFFICIAL_HOST && parsed.port === '';
  if (!isOfficial && !LOOPBACK_HOSTS.has(host) && !LOOPBACK_HOSTS.has(bracketed)) {
    return null;
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  const port = parsed.port === '' ? '' : `:${parsed.port}`;
  return `${parsed.protocol}//${bracketed}${port}${path}`;
}

export type IssueParams = Record<string, string | number>;

export type SaveResult =
  | { ok: true }
  | { ok: false; code: SyncErrorCode; params: IssueParams };

/** 제품 검사 정책 32hex (P-3). 공식 규격이 아니라 관행+조기 탈락용이다. */
const KEY_SHAPE = /^[0-9a-fA-F]{32}$/;

/** 형태 검사. trim 후 길이 32 + hex. 앞뒤 공백 허용, 내부 공백 거부. */
export function isKeyShapeValid(input: string): boolean {
  return KEY_SHAPE.test(input.trim());
}

function isWindows(): boolean {
  return process.platform === 'win32';
}

function hasSecureMode(path: string): boolean {
  if (isWindows()) return false;
  try {
    return (statSync(path).mode & 0o777) === 0o600;
  } catch {
    return false;
  }
}

function readKeyFile(keyPath: string): string | null {
  try {
    if (!isWindows() && !hasSecureMode(keyPath)) return null;
    return readFileSync(keyPath, 'utf8');
  } catch {
    return null;
  }
}

/** 저장된 SteamID. 없으면 null이다. */
function storedSteamId(db: Database.Database): string | null {
  const row = drizzle(db)
    .select({ steamId: account.steamId })
    .from(account)
    .where(eq(account.id, 1))
    .get();
  return row ? row.steamId : null;
}

function writeAccount(db: Database.Database, steamId: string): void {
  const orm = drizzle(db);
  const now = Math.floor(Date.now() / 1000);
  const existing = orm
    .select({ id: account.id })
    .from(account)
    .where(eq(account.id, 1))
    .get();
  if (existing) {
    orm.update(account).set({ steamId, createdAt: now }).where(eq(account.id, 1)).run();
  } else {
    orm.insert(account).values({ id: 1, steamId, createdAt: now }).run();
  }
}

/**
 * 연결 저장. 검증 + SteamID 고정 + 원자 저장.
 * 키 파일 경로는 호출 측이 명시 주입한다. 키 문자열을 반환하지 않는다.
 * 검증·저장·사용은 trim한 값 하나로 통일한다(정규화 저장).
 * 연동 시점에 Steam 1회 검증(P-5)하고 성공해야 저장한다.
 * 검증 fetch는 호출 측 주입(DI)이며 생략 시 전역 fetch다(제품 경로, 정의만).
 * 실패는 code+params만 낸다(원문·키 미반향).
 */
export function saveConnection(input: {
  db: Database.Database;
  keyPath: string;
  keyText: string;
  steamId: string;
  fetchFn?: VerifyFetchFn;
  signal?: AbortSignal;
  /** 테스트 주입용. 없으면 공식 기본. 형태 불일치는 저장 없이 반환한다(제안). */
  baseUrl?: string;
}): Promise<SaveResult> {
  return (async (): Promise<SaveResult> => {
    const key = input.keyText.trim();
    if (!isKeyShapeValid(key)) {
      return { ok: false, code: 'AUTH_INVALID_KEY', params: { reason: 'format' } };
    }
    const base =
      input.baseUrl === undefined ? DEFAULT_STEAM_API_BASE : normalizeSteamBaseUrl(input.baseUrl);
    if (base === null) {
      return { ok: false, code: 'NETWORK', params: { reason: 'upstream' } };
    }
    const existing = storedSteamId(input.db);
    if (existing !== null && existing !== input.steamId) {
      return { ok: false, code: 'AUTH_ID_MISMATCH', params: { reason: 'fixed_id' } };
    }
    const verified = await verifyKeyOnce({
      base,
      key,
      steamId: input.steamId,
      fetchFn: input.fetchFn ?? fetch,
      signal: input.signal,
    });
    if (!verified.ok) return verified;
    try {
      mkdirSync(dirname(input.keyPath), { recursive: true });
      const tmpPath = `${input.keyPath}.${process.pid}.tmp`;
      try {
        writeFileSync(tmpPath, key, { mode: 0o600 });
        if (!isWindows()) {
          chmodSync(tmpPath, 0o600);
        }
        renameSync(tmpPath, input.keyPath);
      } catch (error) {
        try {
          rmSync(tmpPath, { force: true });
        } catch {
          /* 정리 실패는 무시한다 */
        }
        throw error;
      }
      if (!isWindows() && !hasSecureMode(input.keyPath)) {
        return { ok: false, code: 'KEY_STORE_FAILED', params: { reason: 'permission' } };
      }
    } catch {
      return { ok: false, code: 'KEY_STORE_FAILED', params: { reason: 'io' } };
    }
    writeAccount(input.db, input.steamId);
    return { ok: true };
  })();
}

/** 연결 상태. permissionEnforced는 POSIX 600 강제 여부다. */
export function getConnection(db: Database.Database): {
  connected: boolean;
  steamId: string | null;
  permissionEnforced: boolean;
} {
  const steamId = storedSteamId(db);
  return { connected: steamId !== null, steamId, permissionEnforced: !isWindows() };
}

/** 인증 요청 결과. 키 string 반환 없음. */
export type KeyedRequestResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; code: SyncErrorCode; params: IssueParams };

export type FetchLike = (url: string) => Promise<{ status: number; json: () => Promise<unknown> }>;

/** 연동 시점 1회 검증용 fetch. signal은 10초 상한·외부 중단에 쓴다. */
export type VerifyFetchFn = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

/** 검증 상한(PM 선택 #66868). 초과는 NETWORK로 반환하고 저장하지 않는다. */
const VERIFY_TIMEOUT_MS = 10_000;

const VERIFY_PATH = '/ISteamUser/GetPlayerSummaries/v2/';

type VerifyOutcome = SaveResult;

function isPlayerRow(value: unknown): value is { steamid: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { steamid?: unknown }).steamid === 'string'
  );
}

/**
 * 연동 시점 1회 검증(P-5). 성공해야 저장한다.
 * 가짜가 signal을 무시하고 영원히 안 끝나도 10초 안에 끝난다(명시 대기 해제).
 * 실패는 code+params만 낸다(URL·원인·키 미반향).
 */
async function verifyKeyOnce(input: {
  base: string;
  key: string;
  steamId: string;
  fetchFn: VerifyFetchFn;
  signal?: AbortSignal;
}): Promise<VerifyOutcome> {
  if (input.signal?.aborted) {
    return { ok: false, code: 'NETWORK', params: { reason: 'timeout' } };
  }
  const ctrl = new AbortController();
  const onExternalAbort = (): void => {
    ctrl.abort();
  };
  if (input.signal) {
    input.signal.addEventListener('abort', onExternalAbort, { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const url =
      `${input.base}${VERIFY_PATH}?key=${encodeURIComponent(input.key)}` +
      `&steamids=${encodeURIComponent(input.steamId)}`;
    const pending = input.fetchFn(url, { signal: ctrl.signal });
    void pending.catch(() => {
      /* 경합에서 진 쪽의 뒤늦은 실패는 무시한다 */
    });
    const res = await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ctrl.abort();
          reject(new Error('verify timeout'));
        }, VERIFY_TIMEOUT_MS);
      }),
    ]);
    if (res.status === 401 || res.status === 403) {
      return { ok: false, code: 'AUTH_INVALID_KEY', params: { reason: 'rejected' } };
    }
    if (res.status === 429) {
      return { ok: false, code: 'RATE_LIMITED', params: {} };
    }
    if (res.status !== 200) {
      return { ok: false, code: 'NETWORK', params: { reason: 'upstream' } };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, code: 'PAYLOAD_CORRUPT', params: {} };
    }
    const players = (body as { response?: { players?: unknown } } | null)?.response?.players;
    if (!Array.isArray(players) || (players.length > 0 && !players.every(isPlayerRow))) {
      return { ok: false, code: 'PAYLOAD_CORRUPT', params: {} };
    }
    if (players.length === 0 || !players.some((p) => p.steamid === input.steamId)) {
      return { ok: false, code: 'AUTH_ID_MISMATCH', params: { reason: 'not_found' } };
    }
    return { ok: true };
  } catch {
    if (ctrl.signal.aborted) {
      return { ok: false, code: 'NETWORK', params: { reason: 'timeout' } };
    }
    return { ok: false, code: 'NETWORK', params: { reason: 'network' } };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    input.signal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * 인증 요청 ctx. 경로 + 요청 함수만 보관한다.
 * 각 요청에서 키 파일을 읽고 사용 후 해제한다. 키 string 반환 없음.
 */
export function createSteamRequest(opts: {
  keyPath: string;
  fetchFn?: FetchLike;
  /** 테스트 주입용. 없으면 공식 기본. 형태 불일치는 요청마다 실패 반환한다. */
  baseUrl?: string;
}): {
  request: (buildPath: (key: string, base: string) => string) => Promise<KeyedRequestResult>;
  containsSecret: (text: string) => boolean;
} {
  const readKey = (): string | null => readKeyFile(opts.keyPath);
  const fail = (code: SyncErrorCode, params: IssueParams): KeyedRequestResult => ({
    ok: false,
    code,
    params,
  });
  return {
    request: async (buildPath) => {
      const base =
        opts.baseUrl === undefined ? DEFAULT_STEAM_API_BASE : normalizeSteamBaseUrl(opts.baseUrl);
      if (base === null) {
        return fail('NETWORK', { reason: 'upstream' });
      }
      const stored = readKey();
      if (stored === null) {
        return fail('KEY_STORE_FAILED', { reason: 'permission' });
      }
      const key = stored.trim();
      let res: { status: number; json: () => Promise<unknown> };
      try {
        const fetchFn = opts.fetchFn ?? fetch;
        res = await fetchFn(buildPath(key, base));
      } catch {
        return fail('NETWORK', {});
      }
      if (res.status === 401) {
        return fail('AUTH_INVALID_KEY', { status: 401 });
      }
      if (res.status === 403) {
        return fail('ACCESS_PRIVATE', { status: 403 });
      }
      if (res.status === 429) {
        return fail('RATE_LIMITED', { status: 429 });
      }
      if (res.status < 200 || res.status >= 300) {
        return fail('NETWORK', { status: res.status });
      }
      return { ok: true, status: res.status, body: await res.json() };
    },
    containsSecret: (text: string) => {
      const key = readKey();
      if (key === null) return false;
      const trimmed = key.trim();
      return text.includes(key) || text.includes(trimmed) || text.includes(encodeURIComponent(trimmed));
    },
  };
}
