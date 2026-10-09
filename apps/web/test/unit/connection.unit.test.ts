import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KEY_FILE_NAME,
  createSteamRequest,
  getConnection,
  isKeyShapeValid,
  saveConnection,
} from '../../src/data/connection.js';

/**
 * D-15 연결 테스트. 합성 키만 쓴다. 실키·실호출 없음.
 * 형태 32hex 더미는 패턴 문자라 실제 키가 아니다.
 */
const DUMMY = '0123456789abcdef0123456789abcdef';
const ADJACENT = '0123456789abcdef0123456789abcdeg';

function freshDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-d15-'));
  const db = new Database(join(dir, 'questail.db'));
  db.exec(
    'CREATE TABLE account (id integer PRIMARY KEY, steam_id text, created_at integer NOT NULL)',
  );
  return { dir, db };
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

  it('저장하면 600 파일이 생기고 고정 ID를 강제한다', () => {
    const { dir, db } = freshDb();
    try {
      const keyPath = join(dir, 'keys', KEY_FILE_NAME);
      expect(
        saveConnection({ db, keyPath, keyText: DUMMY, steamId: '76561197960287930' }),
      ).toEqual({ ok: true });
      if (process.platform !== 'win32') {
        expect(statSync(keyPath).mode & 0o777).toBe(0o600);
      }
      expect(readFileSync(keyPath, 'utf8')).toBe(DUMMY);
      expect(
        saveConnection({ db, keyPath, keyText: DUMMY, steamId: '76561197960287931' }),
      ).toEqual({
        ok: false,
        code: 'AUTH_ID_MISMATCH',
        params: { reason: 'fixed_id' },
      });
      expect(getConnection(db)).toEqual({
        connected: true,
        steamId: '76561197960287930',
        permissionEnforced: process.platform !== 'win32',
      });
    } finally {
      db.close();
    }
  });

  it('형태 불일치는 저장 없이 실패한다', () => {
    const { dir, db } = freshDb();
    try {
      expect(
        saveConnection({ db, keyPath: join(dir, KEY_FILE_NAME), keyText: 'bad', steamId: '1' }),
      ).toEqual({ ok: false, code: 'AUTH_INVALID_KEY', params: { reason: 'format' } });
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

  it('containsSecret은 exact·encoded만 true다', () => {
    const { dir, db } = freshDb();
    try {
      const keyPath = join(dir, KEY_FILE_NAME);
      const ctx = createSteamRequest({ keyPath, fetchFn: async () => ({ status: 200, json: async () => ({}) }) });
      expect(ctx.containsSecret('nope')).toBe(false);
      saveConnection({ db, keyPath, keyText: DUMMY, steamId: '76561197960287930' });
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
      saveConnection({ db, keyPath, keyText: DUMMY, steamId: '76561197960287930' });
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
});
