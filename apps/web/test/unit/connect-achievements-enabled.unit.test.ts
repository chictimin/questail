import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { VerifyFetchFn } from '../../src/data/connection.js';
import { KEY_FILE_NAME, saveConnection } from '../../src/data/connection.js';
import { createApp } from '../../src/server/app.js';
import { CONNECT_PATH, connectKeyPath } from '../../src/server/routes/connect.js';

/**
 * U1 POST /api/connect achievementsEnabled + saveConnection 순서 테스트.
 * 합성 DB(제품 SQL) + 임시 dataDir + 가짜 Steam fetch만 쓴다. 실키·실호출 없음.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOST = { host: '127.0.0.1:4747' };
const JSON_HEADERS = { ...HOST, 'content-type': 'application/json' };
const DUMMY = '0123456789abcdef0123456789abcdef';
const SID = '76561197960287930';

function freshDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-u1connect-'));
  const journal = JSON.parse(
    readFileSync(join(WEB, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const setup = new Database(join(dir, 'questail.db'));
  try {
    for (const entry of journal.entries) {
      setup.exec(readFileSync(join(WEB, 'drizzle', `${entry.tag}.sql`), 'utf8'));
    }
  } finally {
    setup.close();
  }
  return { dir, db: new Database(join(dir, 'questail.db')) };
}

function okFetch(steamId: string): VerifyFetchFn {
  return async () => ({
    status: 200,
    json: async () => ({ response: { players: [{ steamid: steamId }] } }),
  });
}

function optionValue(db: Database.Database): string | null {
  const row = db
    .prepare('SELECT value AS v FROM preferences WHERE key = ?')
    .get('achievement_enabled') as { v: string } | undefined;
  return row ? row.v : null;
}

function optionRow(db: Database.Database): unknown {
  return db
    .prepare('SELECT key, value, updated_at FROM preferences WHERE key = ?')
    .get('achievement_enabled');
}

function accountRow(db: Database.Database): unknown {
  return db.prepare('SELECT id, steam_id, created_at FROM account').get();
}

function tmpFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith('.tmp'));
}

async function postConnect(
  app: ReturnType<typeof createApp>,
  body: unknown,
): Promise<Response> {
  return await app.request(CONNECT_PATH, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

describe('POST /api/connect achievementsEnabled 가드', () => {
  it('"1" → 400 INVALID_BODY{body}, fetch 호출 0', async () => {
    const { dir, db } = freshDb();
    try {
      let calls = 0;
      const counting: VerifyFetchFn = async () => {
        calls += 1;
        return { status: 200, json: async () => ({}) };
      };
      const app = createApp(undefined, {
        db,
        keyPath: connectKeyPath(dir),
        fetchFn: counting,
      });
      const response = await postConnect(app, {
        keyText: DUMMY,
        steamId: SID,
        achievementsEnabled: '1',
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        code: 'INVALID_BODY',
        params: { reason: 'body' },
      });
      expect(calls).toBe(0);
      expect(existsSync(connectKeyPath(dir))).toBe(false);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('true·false 저장이 옵션 행에 반영된다', async () => {
    const { dir, db } = freshDb();
    try {
      const keyPath = connectKeyPath(dir);
      const app = createApp(undefined, { db, keyPath, fetchFn: okFetch(SID) });
      const r1 = await postConnect(app, {
        keyText: DUMMY,
        steamId: SID,
        achievementsEnabled: true,
      });
      expect(r1.status).toBe(200);
      expect(optionValue(db)).toBe('1');
      expect(readFileSync(keyPath, 'utf8')).toBe(DUMMY);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('false 저장이 옵션 행에 반영된다', async () => {
    const { dir, db } = freshDb();
    try {
      const app = createApp(undefined, {
        db,
        keyPath: connectKeyPath(dir),
        fetchFn: okFetch(SID),
      });
      const response = await postConnect(app, {
        keyText: DUMMY,
        steamId: SID,
        achievementsEnabled: false,
      });
      expect(response.status).toBe(200);
      expect(optionValue(db)).toBe('0');
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('필드 없으면 옵션 불변(재연동)', async () => {
    const { dir, db } = freshDb();
    try {
      const app = createApp(undefined, {
        db,
        keyPath: connectKeyPath(dir),
        fetchFn: okFetch(SID),
      });
      expect(
        (await postConnect(app, { keyText: DUMMY, steamId: SID, achievementsEnabled: true }))
          .status,
      ).toBe(200);
      expect(optionValue(db)).toBe('1');
      expect((await postConnect(app, { keyText: DUMMY, steamId: SID })).status).toBe(200);
      expect(optionValue(db)).toBe('1');
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('saveConnection 순서·실패 원자성', () => {
  it('true·false를 명시 저장한다', async () => {
    const { dir, db } = freshDb();
    try {
      const keyPath = join(dir, KEY_FILE_NAME);
      await expect(
        saveConnection({ db, keyPath, keyText: DUMMY, steamId: SID, achievementsEnabled: true, fetchFn: okFetch(SID) }),
      ).resolves.toEqual({ ok: true });
      expect(optionValue(db)).toBe('1');
      expect(readFileSync(keyPath, 'utf8')).toBe(DUMMY);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('트랜잭션 실패(첫 연동) → 계정 0행·옵션 0행·키 없음·임시 없음', async () => {
    const { dir, db } = freshDb();
    try {
      db.exec(
        "CREATE TRIGGER u1_abort_pref_insert BEFORE INSERT ON preferences BEGIN SELECT RAISE(ABORT, 'injected'); END",
      );
      const keyPath = join(dir, KEY_FILE_NAME);
      await expect(
        saveConnection({ db, keyPath, keyText: DUMMY, steamId: SID, achievementsEnabled: true, fetchFn: okFetch(SID) }),
      ).resolves.toEqual({ ok: false, code: 'KEY_STORE_FAILED', params: { reason: 'io' } });
      expect(db.prepare('SELECT COUNT(*) AS n FROM account').get()).toEqual({ n: 0 });
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM preferences WHERE key = ?').get('achievement_enabled'),
      ).toEqual({ n: 0 });
      expect(existsSync(keyPath)).toBe(false);
      expect(tmpFiles(dir)).toEqual([]);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('트랜잭션 실패(재연동) → 계정 행·키 바이트·옵션 이전과 동일·임시 없음', async () => {
    const { dir, db } = freshDb();
    try {
      const keyPath = join(dir, KEY_FILE_NAME);
      await expect(
        saveConnection({ db, keyPath, keyText: DUMMY, steamId: SID, achievementsEnabled: true, fetchFn: okFetch(SID) }),
      ).resolves.toEqual({ ok: true });
      const beforeAccount = accountRow(db);
      const beforeKey = readFileSync(keyPath, 'utf8');
      const beforeOption = optionRow(db);
      db.exec(
        "CREATE TRIGGER u1_abort_pref_update BEFORE UPDATE ON preferences BEGIN SELECT RAISE(ABORT, 'injected'); END",
      );
      await expect(
        saveConnection({ db, keyPath, keyText: DUMMY, steamId: SID, achievementsEnabled: false, fetchFn: okFetch(SID) }),
      ).resolves.toEqual({ ok: false, code: 'KEY_STORE_FAILED', params: { reason: 'io' } });
      expect(accountRow(db)).toEqual(beforeAccount);
      expect(readFileSync(keyPath, 'utf8')).toBe(beforeKey);
      expect(optionRow(db)).toEqual(beforeOption);
      expect(optionValue(db)).toBe('1');
      expect(tmpFiles(dir)).toEqual([]);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rename 실패(재연동) → 계정 행·키 바이트·옵션 이전과 동일·임시 없음', async () => {
    const { dir, db } = freshDb();
    try {
      const keyPath = join(dir, KEY_FILE_NAME);
      await expect(
        saveConnection({ db, keyPath, keyText: DUMMY, steamId: SID, achievementsEnabled: true, fetchFn: okFetch(SID) }),
      ).resolves.toEqual({ ok: true });
      const beforeAccount = accountRow(db);
      const beforeKey = readFileSync(keyPath, 'utf8');
      const beforeOption = optionRow(db);
      const failingRename = (): void => {
        throw new Error('injected rename failure');
      };
      await expect(
        saveConnection({
          db,
          keyPath,
          keyText: DUMMY,
          steamId: SID,
          achievementsEnabled: false,
          fetchFn: okFetch(SID),
          renameTmp: failingRename,
        }),
      ).resolves.toEqual({ ok: false, code: 'KEY_STORE_FAILED', params: { reason: 'io' } });
      expect(accountRow(db)).toEqual(beforeAccount);
      expect(readFileSync(keyPath, 'utf8')).toBe(beforeKey);
      expect(optionRow(db)).toEqual(beforeOption);
      expect(optionValue(db)).toBe('1');
      expect(tmpFiles(dir)).toEqual([]);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rename 실패(첫 연동) → 계정 0행·옵션 0행·키 없음·임시 없음', async () => {
    const { dir, db } = freshDb();
    try {
      const keyPath = join(dir, KEY_FILE_NAME);
      const failingRename = (): void => {
        throw new Error('injected rename failure');
      };
      await expect(
        saveConnection({
          db,
          keyPath,
          keyText: DUMMY,
          steamId: SID,
          achievementsEnabled: true,
          fetchFn: okFetch(SID),
          renameTmp: failingRename,
        }),
      ).resolves.toEqual({ ok: false, code: 'KEY_STORE_FAILED', params: { reason: 'io' } });
      expect(db.prepare('SELECT COUNT(*) AS n FROM account').get()).toEqual({ n: 0 });
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM preferences WHERE key = ?').get('achievement_enabled'),
      ).toEqual({ n: 0 });
      expect(existsSync(keyPath)).toBe(false);
      expect(tmpFiles(dir)).toEqual([]);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
