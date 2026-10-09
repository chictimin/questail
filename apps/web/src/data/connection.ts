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
 * 실패는 code+params만 낸다(원문·키 미반향).
 */
export function saveConnection(input: {
  db: Database.Database;
  keyPath: string;
  keyText: string;
  steamId: string;
}): SaveResult {
  const key = input.keyText.trim();
  if (!isKeyShapeValid(key)) {
    return { ok: false, code: 'AUTH_INVALID_KEY', params: { reason: 'format' } };
  }
  const existing = storedSteamId(input.db);
  if (existing !== null && existing !== input.steamId) {
    return { ok: false, code: 'AUTH_ID_MISMATCH', params: { reason: 'fixed_id' } };
  }
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

/**
 * 인증 요청 ctx. 경로 + 요청 함수만 보관한다.
 * 각 요청에서 키 파일을 읽고 사용 후 해제한다. 키 string 반환 없음.
 */
export function createSteamRequest(opts: { keyPath: string; fetchFn?: FetchLike }): {
  request: (buildPath: (key: string) => string) => Promise<KeyedRequestResult>;
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
      const stored = readKey();
      if (stored === null) {
        return fail('KEY_STORE_FAILED', { reason: 'permission' });
      }
      const key = stored.trim();
      let res: { status: number; json: () => Promise<unknown> };
      try {
        const fetchFn = opts.fetchFn ?? fetch;
        res = await fetchFn(buildPath(key));
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
