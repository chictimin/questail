import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KEY_FILE_NAME,
  createSteamRequest,
  getConnection,
  isKeyShapeValid,
  saveConnection,
} from '../../src/data/connection.js';
import type { VerifyFetchFn } from '../../src/data/connection.js';

/**
 * D-15 연결 테스트 + P-5 연동 검증 테스트. 합성 키·가짜 fetch만 쓴다.
 * 실키·실호출 없음. 형태 32hex 더미는 패턴 문자라 실제 키가 아니다.
 * saveConnection 호출은 전부 가짜 fetch를 주입한다(전역 fetch 실행 금지).
 */
const DUMMY = '0123456789abcdef0123456789abcdef';
const ADJACENT = '0123456789abcdef0123456789abcdeg';
const SID = '76561197960287930';

function freshDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-d15-'));
  const db = new Database(join(dir, 'questail.db'));
  db.exec(
    'CREATE TABLE account (id integer PRIMARY KEY, steam_id text, created_at integer NOT NULL)',
  );
  return { dir, db };
}

function playersBody(steamId: string): unknown {
  return { response: { players: [{ steamid: steamId }] } };
}

/** 검증 성공 가짜. 호출 URL을 기록한다. */
function verifyOk(steamId: string, seen?: { url: string }): VerifyFetchFn {
  return async (url: string) => {
    if (seen) seen.url = url;
    return { status: 200, json: async () => playersBody(steamId) };
  };
}

function verifyStatus(status: number, body?: unknown): VerifyFetchFn {
  return async () => ({ status, json: async () => body ?? {} });
}

describe('connection', () => {
  it('형태 검사는 32hex만 통과시킨다', () => {
    expect(isKeyShapeValid(DUMMY)).toBe(true);
    expect(isKeyShapeValid(`  ${DUMMY}  `)).toBe(true);
    expect(isKeyShapeValid('short')).toBe(false);
    expect(isKeyShapeValid('')).toBe(false);
    expect(isKeyShapeValid('0123456789abcdef0123456789abcde ')).toBe(false);
    expect(isKeyShapeValid('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toBe(false);
    expect(isKeyShapeValid('0123 56789abcdef0123456789abcdef')).toBe(false);
  });

  it('저장하면 600 파일이 생기고 고정 ID를 강제한다', async () => {
    const { dir, db } = freshDb();
    try {
      const keyPath = join(dir, 'keys', KEY_FILE_NAME);
      await expect(
        saveConnection({ db, keyPath, keyText: DUMMY, steamId: SID, fetchFn: verifyOk(SID) }),
      ).resolves.toEqual({ ok: true });
      if (process.platform !== 'win32') {
        expect(statSync(keyPath).mode & 0o777).toBe(0o600);
      }
      expect(readFileSync(keyPath, 'utf8')).toBe(DUMMY);
      await expect(
        saveConnection({ db, keyPath, keyText: DUMMY, steamId: '76561197960287931', fetchFn: verifyOk(SID) }),
      ).resolves.toEqual({
        ok: false,
        code: 'AUTH_ID_MISMATCH',
        params: { reason: 'fixed_id' },
      });
      expect(getConnection(db)).toEqual({
        connected: true,
        steamId: SID,
        permissionEnforced: process.platform !== 'win32',
      });
    } finally {
      db.close();
    }
  });

  it('형태 불일치는 검증 호출 없이 실패한다', async () => {
    const { dir, db } = freshDb();
    try {
      let calls = 0;
      const counting: VerifyFetchFn = async () => {
        calls += 1;
        return { status: 200, json: async () => ({}) };
      };
      await expect(
        saveConnection({ db, keyPath: join(dir, KEY_FILE_NAME), keyText: 'bad', steamId: '1', fetchFn: counting }),
      ).resolves.toEqual({ ok: false, code: 'AUTH_INVALID_KEY', params: { reason: 'format' } });
      expect(calls).toBe(0);
    } finally {
      db.close();
    }
  });

  it('미연결 상태는 비어 있다', () => {
    const { db } = freshDb();
    try {
      expect(getConnection(db).connected).toBe(false);
    } finally {
      db.close();
    }
  });

  it('containsSecret은 exact·encoded만 true다', async () => {
    const { dir, db } = freshDb();
    try {
      const keyPath = join(dir, KEY_FILE_NAME);
      const ctx = createSteamRequest({ keyPath, fetchFn: async () => ({ status: 200, json: async () => ({}) }) });
      expect(ctx.containsSecret('nope')).toBe(false);
      await saveConnection({ db, keyPath, keyText: DUMMY, steamId: SID, fetchFn: verifyOk(SID) });
      expect(ctx.containsSecret(`prefix ${DUMMY} suffix`)).toBe(true);
      expect(ctx.containsSecret(`q=${encodeURIComponent(DUMMY)}`)).toBe(true);
      expect(ctx.containsSecret(ADJACENT)).toBe(false);
    } finally {
      db.close();
    }
  });

  it('request는 가짜 fetch로 code+params를 낸다', async () => {
    const { dir, db } = freshDb();
    try {
      const keyPath = join(dir, KEY_FILE_NAME);
      await saveConnection({ db, keyPath, keyText: DUMMY, steamId: SID, fetchFn: verifyOk(SID) });
      const okCtx = createSteamRequest({
        keyPath,
        fetchFn: async () => ({ status: 200, json: async () => ({ response: {} }) }),
      });
      expect(await okCtx.request(() => 'https://example.invalid/x')).toEqual({
        ok: true,
        status: 200,
        body: { response: {} },
      });
      const denied = createSteamRequest({
        keyPath,
        fetchFn: async () => ({ status: 401, json: async () => ({}) }),
      });
      expect(await denied.request(() => 'https://example.invalid/x')).toEqual({
        ok: false,
        code: 'AUTH_INVALID_KEY',
        params: { status: 401 },
      });
      const down = createSteamRequest({
        keyPath,
        fetchFn: async () => {
          throw new Error('down');
        },
      });
      expect(await down.request(() => 'https://example.invalid/x')).toEqual({
        ok: false,
        code: 'NETWORK',
        params: {},
      });
    } finally {
      db.close();
    }
  });

  it('앞뒤 공백 키는 trim값으로 저장한다(파일에 공백 0)', async () => {
    const { dir, db } = freshDb();
    try {
      const keyPath = join(dir, KEY_FILE_NAME);
      await expect(
        saveConnection({ db, keyPath, keyText: `  ${DUMMY}  `, steamId: SID, fetchFn: verifyOk(SID) }),
      ).resolves.toEqual({ ok: true });
      expect(readFileSync(keyPath, 'utf8')).toBe(DUMMY);
    } finally {
      db.close();
    }
  });

  it('요청 URL에는 trim값 하나만 쓴다(앞뒤 공백 0)', async () => {
    const { dir, db } = freshDb();
    try {
      const keyPath = join(dir, KEY_FILE_NAME);
      await saveConnection({ db, keyPath, keyText: `  ${DUMMY}  `, steamId: SID, fetchFn: verifyOk(SID) });
      let seenUrl = '';
      const ctx = createSteamRequest({
        keyPath,
        fetchFn: async (url: string) => {
          seenUrl = url;
          return { status: 200, json: async () => ({}) };
        },
      });
      await ctx.request((key) => `https://example.invalid/x?key=${key}`);
      expect(seenUrl).toBe(`https://example.invalid/x?key=${DUMMY}`);
    } finally {
      db.close();
    }
  });

  it('검증 URL에 trim 키·steamId를 싣는다', async () => {
    const { dir, db } = freshDb();
    try {
      const keyPath = join(dir, KEY_FILE_NAME);
      const seen = { url: '' };
      await expect(
        saveConnection({ db, keyPath, keyText: `  ${DUMMY}  `, steamId: SID, fetchFn: verifyOk(SID, seen) }),
      ).resolves.toEqual({ ok: true });
      expect(seen.url).toBe(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${DUMMY}&steamids=${SID}`,
      );
    } finally {
      db.close();
    }
  });

  it('401은 rejected로 저장 없이 실패한다(기존 키·계정 보존)', async () => {
    const { dir, db } = freshDb();
    try {
      const keyPath = join(dir, KEY_FILE_NAME);
      await expect(
        saveConnection({ db, keyPath, keyText: DUMMY, steamId: SID, fetchFn: verifyStatus(401) }),
      ).resolves.toEqual({ ok: false, code: 'AUTH_INVALID_KEY', params: { reason: 'rejected' } });
      expect(existsSync(keyPath)).toBe(false);
      expect(getConnection(db).connected).toBe(false);
    } finally {
      db.close();
    }
  });

  it('429·500은 RATE_LIMITED·upstream으로 저장 없이 실패한다', async () => {
    const { dir, db } = freshDb();
    try {
      await expect(
        saveConnection({ db, keyPath: join(dir, 'a.key'), keyText: DUMMY, steamId: SID, fetchFn: verifyStatus(429) }),
      ).resolves.toEqual({ ok: false, code: 'RATE_LIMITED', params: {} });
      await expect(
        saveConnection({ db, keyPath: join(dir, 'b.key'), keyText: DUMMY, steamId: SID, fetchFn: verifyStatus(500) }),
      ).resolves.toEqual({ ok: false, code: 'NETWORK', params: { reason: 'upstream' } });
      expect(existsSync(join(dir, 'a.key'))).toBe(false);
      expect(existsSync(join(dir, 'b.key'))).toBe(false);
    } finally {
      db.close();
    }
  });

  it('깨진 JSON·players 부재는 PAYLOAD_CORRUPT다', async () => {
    const { dir, db } = freshDb();
    try {
      const broken: VerifyFetchFn = async () => ({
        status: 200,
        json: async () => {
          throw new Error('bad json');
        },
      });
      await expect(
        saveConnection({ db, keyPath: join(dir, 'a.key'), keyText: DUMMY, steamId: SID, fetchFn: broken }),
      ).resolves.toEqual({ ok: false, code: 'PAYLOAD_CORRUPT', params: {} });
      await expect(
        saveConnection({
          db,
          keyPath: join(dir, 'b.key'),
          keyText: DUMMY,
          steamId: SID,
          fetchFn: verifyStatus(200, { response: {} }),
        }),
      ).resolves.toEqual({ ok: false, code: 'PAYLOAD_CORRUPT', params: {} });
    } finally {
      db.close();
    }
  });

  it('빈 players·다른 ID만 있으면 not_found로 저장하지 않는다', async () => {
    const { dir, db } = freshDb();
    try {
      await expect(
        saveConnection({
          db,
          keyPath: join(dir, 'a.key'),
          keyText: DUMMY,
          steamId: SID,
          fetchFn: verifyStatus(200, { response: { players: [] } }),
        }),
      ).resolves.toEqual({ ok: false, code: 'AUTH_ID_MISMATCH', params: { reason: 'not_found' } });
      await expect(
        saveConnection({
          db,
          keyPath: join(dir, 'b.key'),
          keyText: DUMMY,
          steamId: SID,
          fetchFn: verifyStatus(200, { response: { players: [{ steamid: '1' }] } }),
        }),
      ).resolves.toEqual({ ok: false, code: 'AUTH_ID_MISMATCH', params: { reason: 'not_found' } });
      expect(existsSync(join(dir, 'a.key'))).toBe(false);
      expect(existsSync(join(dir, 'b.key'))).toBe(false);
    } finally {
      db.close();
    }
  });

  it('fetch 실패는 NETWORK network다', async () => {
    const { dir, db } = freshDb();
    try {
      const down: VerifyFetchFn = async () => {
        throw new Error('down');
      };
      await expect(
        saveConnection({ db, keyPath: join(dir, KEY_FILE_NAME), keyText: DUMMY, steamId: SID, fetchFn: down }),
      ).resolves.toEqual({ ok: false, code: 'NETWORK', params: { reason: 'network' } });
    } finally {
      db.close();
    }
  });

  it('이미 중단된 signal은 호출 없이 timeout이다', async () => {
    const { dir, db } = freshDb();
    try {
      let calls = 0;
      const counting: VerifyFetchFn = async () => {
        calls += 1;
        return { status: 200, json: async () => ({}) };
      };
      const ctrl = new AbortController();
      ctrl.abort();
      await expect(
        saveConnection({
          db,
          keyPath: join(dir, KEY_FILE_NAME),
          keyText: DUMMY,
          steamId: SID,
          fetchFn: counting,
          signal: ctrl.signal,
        }),
      ).resolves.toEqual({ ok: false, code: 'NETWORK', params: { reason: 'timeout' } });
      expect(calls).toBe(0);
    } finally {
      db.close();
    }
  });

  it('signal을 무시하고 안 끝나는 가짜도 10초 안에 timeout이다', async () => {
    vi.useFakeTimers();
    try {
      const { dir, db } = freshDb();
      try {
        const hanging = new Promise<{ status: number; json: () => Promise<unknown> }>(() => {});
        const pending = saveConnection({
          db,
          keyPath: join(dir, KEY_FILE_NAME),
          keyText: DUMMY,
          steamId: SID,
          fetchFn: () => hanging,
        });
        await vi.advanceTimersByTimeAsync(10_000);
        await expect(pending).resolves.toEqual({
          ok: false,
          code: 'NETWORK',
          params: { reason: 'timeout' },
        });
      } finally {
        db.close();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
