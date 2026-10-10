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
import { account, preferences } from '../db/schema.js';

/** 키 파일명. A가 export하고 B가 같은 상수를 import한다 (P-3). */
export const KEY_FILE_NAME = 'steam.key';

/** 제품 기본 공식 URL. README에 노출하지 않는다 (P-6). */
export const DEFAULT_STEAM_API_BASE = 'https://api.steampowered.com';

/** baseURL 정규화 단일 구현(core). 웹 호출 변경 없이 재수출한다 (P-6). */
import { normalizeSteamBaseUrl } from '@questail/core';

export { normalizeSteamBaseUrl };

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
  const row = readAccountRow(db);
  return row ? row.steamId : null;
}

type AccountSnapshot = { steamId: string | null; createdAt: number };

function readAccountRow(db: Database.Database): AccountSnapshot | null {
  const row = drizzle(db)
    .select({ steamId: account.steamId, createdAt: account.createdAt })
    .from(account)
    .where(eq(account.id, 1))
    .get();
  return row ?? null;
}

type OptionSnapshot = { value: string; updatedAt: number };

function readOptionRow(db: Database.Database): OptionSnapshot | null {
  const row = drizzle(db)
    .select({ value: preferences.value, updatedAt: preferences.updatedAt })
    .from(preferences)
    .where(eq(preferences.key, 'achievement_enabled'))
    .get();
  return row ?? null;
}

function writeOption(db: Database.Database, enabled: boolean): void {
  const orm = drizzle(db);
  const now = Math.floor(Date.now() / 1000);
  const value = enabled ? '1' : '0';
  const existing = orm
    .select({ key: preferences.key })
    .from(preferences)
    .where(eq(preferences.key, 'achievement_enabled'))
    .get();
  if (existing) {
    orm
      .update(preferences)
      .set({ value, updatedAt: now })
      .where(eq(preferences.key, 'achievement_enabled'))
      .run();
  } else {
    orm.insert(preferences).values({ key: 'achievement_enabled', value, updatedAt: now }).run();
  }
}

function restoreOption(db: Database.Database, snapshot: OptionSnapshot): void {
  drizzle(db)
    .update(preferences)
    .set({ value: snapshot.value, updatedAt: snapshot.updatedAt })
    .where(eq(preferences.key, 'achievement_enabled'))
    .run();
}

function deleteOption(db: Database.Database): void {
  drizzle(db).delete(preferences).where(eq(preferences.key, 'achievement_enabled')).run();
}

function restoreAccount(db: Database.Database, snapshot: AccountSnapshot): void {
  drizzle(db)
    .update(account)
    .set({ steamId: snapshot.steamId, createdAt: snapshot.createdAt })
    .where(eq(account.id, 1))
    .run();
}

function deleteAccount(db: Database.Database): void {
  drizzle(db).delete(account).where(eq(account.id, 1)).run();
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
 * 순서(R12-3): ① 검증 성공(이전 계정·옵션 값 읽기) → ② 새 키를 임시 파일(키 경로 옆, 600)에 쓰기
 * → ③ 한 DB 트랜잭션(계정 행 + 값 있으면 achievement_enabled 행, true·false 모두 저장)
 * → ④ 커밋 후 임시 파일을 키 경로로 rename → ok.
 * 실패 응답이면 키 파일·계정 행·옵션 모두 요청 전 그대로다:
 * ② 실패 → 임시 삭제·KEY_STORE_FAILED, ③ 실패 → 롤백 + 임시 삭제·KEY_STORE_FAILED reason=io,
 * ④ rename 실패 → 보상 트랜잭션(첫 연동이면 계정 행 삭제, 옵션은 이전 값 복원 또는 이전에 없었으면 삭제)
 * + 임시 삭제·KEY_STORE_FAILED reason=io. 필드 없으면 옵션 불변.
 * 실패는 code+params만 낸다(원문·키 미반향).
 */
export function saveConnection(input: {
  db: Database.Database;
  keyPath: string;
  keyText: string;
  steamId: string;
  achievementsEnabled?: boolean;
  fetchFn?: VerifyFetchFn;
  signal?: AbortSignal;
  /** 테스트 주입용. 없으면 공식 기본. 형태 불일치는 저장 없이 반환한다(제안). */
  baseUrl?: string;
  /** 테스트 주입용 rename. 없으면 node:fs renameSync. rename 실패 경로에만 쓴다. */
  renameTmp?: (tmpPath: string, keyPath: string) => void;
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
    const prevAccount = readAccountRow(input.db);
    let prevOption: OptionSnapshot | null = null;
    if (input.achievementsEnabled !== undefined) {
      try {
        prevOption = readOptionRow(input.db);
      } catch {
        return { ok: false, code: 'KEY_STORE_FAILED', params: { reason: 'io' } };
      }
    }
    const tmpPath = `${input.keyPath}.${process.pid}.tmp`;
    const removeTmp = (): void => {
      try {
        rmSync(tmpPath, { force: true });
      } catch {
        /* 정리 실패는 무시한다 */
      }
    };
    try {
      mkdirSync(dirname(input.keyPath), { recursive: true });
      writeFileSync(tmpPath, key, { mode: 0o600 });
      if (!isWindows()) {
        chmodSync(tmpPath, 0o600);
      }
    } catch {
      removeTmp();
      return { ok: false, code: 'KEY_STORE_FAILED', params: { reason: 'io' } };
    }
    if (!isWindows() && !hasSecureMode(tmpPath)) {
      removeTmp();
      return { ok: false, code: 'KEY_STORE_FAILED', params: { reason: 'permission' } };
    }
    try {
      const storeAll = input.db.transaction(() => {
        writeAccount(input.db, input.steamId);
        if (input.achievementsEnabled !== undefined) {
          writeOption(input.db, input.achievementsEnabled);
        }
      });
      storeAll();
    } catch {
      removeTmp();
      return { ok: false, code: 'KEY_STORE_FAILED', params: { reason: 'io' } };
    }
    try {
      (input.renameTmp ?? renameSync)(tmpPath, input.keyPath);
    } catch {
      try {
        const compensate = input.db.transaction(() => {
          if (prevAccount === null) {
            deleteAccount(input.db);
          } else {
            restoreAccount(input.db, prevAccount);
          }
          if (input.achievementsEnabled !== undefined) {
            if (prevOption === null) {
              deleteOption(input.db);
            } else {
              restoreOption(input.db, prevOption);
            }
          }
        });
        compensate();
      } catch {
        /* 보상 실패도 같은 코드로 답한다. 계정·옵션·키 상태는 미보장 */
      }
      removeTmp();
      return { ok: false, code: 'KEY_STORE_FAILED', params: { reason: 'io' } };
    }
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
  /** 목록의 status는 실패로 바꾸지 않고 `{ok:true, status, body}`로 넘긴다(JSON 파싱 실패 시 body null). 401·403·429는 목록에 있어도 기존 실패 변환이 우선한다. 생략 시 기존 동작 불변. */
  passStatus?: number[];
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
      if (opts.passStatus?.includes(res.status)) {
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        return { ok: true, status: res.status, body };
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
