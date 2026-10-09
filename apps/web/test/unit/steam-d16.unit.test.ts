import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSteamRequest,
  normalizeSteamBaseUrl,
  saveConnection,
} from '../../src/data/connection.js';

/**
 * D-16 baseURL·신규 픽스처 테스트. 합성 값만 쓴다. 실호출 없음.
 */
const STEAM = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'steam');
const DUMMY = '0123456789abcdef0123456789abcdef';

function freshDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'questail-d16-'));
  const db = new Database(join(dir, 'questail.db'));
  db.exec(
    'CREATE TABLE account (id integer PRIMARY KEY, steam_id text, created_at integer NOT NULL)',
  );
  return db;
}

describe('normalizeSteamBaseUrl', () => {
  it('공식 기본과 루프백을 정규화한다', () => {
    expect(normalizeSteamBaseUrl('https://api.steampowered.com')).toBe(
      'https://api.steampowered.com',
    );
    expect(normalizeSteamBaseUrl('https://api.steampowered.com/')).toBe(
      'https://api.steampowered.com',
    );
    expect(normalizeSteamBaseUrl('http://127.0.0.1:8080/api/')).toBe('http://127.0.0.1:8080/api');
    expect(normalizeSteamBaseUrl('http://localhost:9')).toBe('http://localhost:9');
    expect(normalizeSteamBaseUrl('http://[::1]:8080/')).toBe('http://[::1]:8080');
  });

  it('userinfo·query·fragment·비루프백·쓰레기를 거부한다', () => {
    expect(normalizeSteamBaseUrl('https://user@api.steampowered.com')).toBeNull();
    expect(normalizeSteamBaseUrl('https://api.steampowered.com/?x=1')).toBeNull();
    expect(normalizeSteamBaseUrl('https://api.steampowered.com/#f')).toBeNull();
    expect(normalizeSteamBaseUrl('https://example.com/')).toBeNull();
    expect(normalizeSteamBaseUrl('not-a-url')).toBeNull();
    expect(normalizeSteamBaseUrl('')).toBeNull();
    expect(normalizeSteamBaseUrl('ftp://127.0.0.1/')).toBeNull();
  });
});

describe('baseUrl 주입', () => {
  it('saveConnection 검증 URL에 주입 base를 쓴다', async () => {
    const db = freshDb();
    try {
      let seen = '';
      const result = await saveConnection({
        db,
        keyPath: join(tmpdir(), `questail-d16-${Date.now()}`, 'steam.key'),
        keyText: DUMMY,
        steamId: '76561197960287930',
        baseUrl: 'http://127.0.0.1:8080/api/',
        fetchFn: (async (url: string) => {
          seen = url;
          return {
            status: 200,
            json: async () => ({
              response: { players: [{ steamid: '76561197960287930' }] },
            }),
          };
        }) as never,
      });
      expect(result).toEqual({ ok: true });
      expect(seen.startsWith('http://127.0.0.1:8080/api/ISteamUser/')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('형태 불일치 baseUrl은 저장 없이 실패한다', async () => {
    const db = freshDb();
    try {
      const result = await saveConnection({
        db,
        keyPath: join(tmpdir(), 'steam.key'),
        keyText: DUMMY,
        steamId: '76561197960287930',
        baseUrl: 'https://example.com/',
        fetchFn: (async () => ({ status: 200, json: async () => ({}) })) as never,
      });
      expect(result).toEqual({ ok: false, code: 'NETWORK', params: { reason: 'upstream' } });
    } finally {
      db.close();
    }
  });
});

describe('steam fixtures', () => {
  it('신규 5종과 7시나리오를 읽어 파싱한다', () => {
    for (const name of [
      'appdetails.json',
      'wishlist.json',
      'achievements-990011.json',
      'achievements-empty.json',
      'steamspy.json',
      'scenarios.json',
    ]) {
      expect(() => JSON.parse(readFileSync(join(STEAM, name), 'utf8'))).not.toThrow();
    }
    const scenarios = JSON.parse(readFileSync(join(STEAM, 'scenarios.json'), 'utf8')) as {
      scenarios: { id: string }[];
    };
    expect(scenarios.scenarios).toHaveLength(7);
  });

  it('형태 불일치 baseUrl 요청은 실패한다', async () => {
    const ctx = createSteamRequest({
      keyPath: join(tmpdir(), 'steam.key'),
      fetchFn: async () => ({ status: 200, json: async () => ({}) }),
      baseUrl: 'https://example.com/',
    });
    expect(await ctx.request(() => '/x')).toEqual({
      ok: false,
      code: 'NETWORK',
      params: { reason: 'upstream' },
    });
  });
});
