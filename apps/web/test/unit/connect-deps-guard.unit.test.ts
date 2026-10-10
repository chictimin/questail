import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServerApp } from '../../src/server/app.js';
import { createDataHolder } from '../../src/server/dataHolder.js';
import {
  CONNECT_PATH,
  connectKeyPath,
} from '../../src/server/routes/connect.js';

/**
 * D16-2 B5 — holder(db 있음)만 있고 connectDeps가 없으면 POST /api/connect는
 * Steam 요청·DB 접근 전에 throw → 500 INTERNAL. 전역 fetch를 가짜로 바꿔
 * 실 Steam 호출 0을 단언한다.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOST = { host: '127.0.0.1:4747' };
const JSON_HEADERS = { ...HOST, 'content-type': 'application/json' };
const DUMMY_KEY = 'abcdef0123456789abcdef0123456789';
const STEAM_ID = '76561198000000001';

function freshDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-b5-'));
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

describe('POST /api/connect deps 가드(D16-2 B5)', () => {
  it('holder만 있고 connectDeps 없음 → 500·전역 fetch 호출 0', async () => {
    const globalFetch = vi.fn(async () => ({
      status: 200,
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', globalFetch);
    const { dir, db } = freshDb();
    try {
      const keyPath = connectKeyPath(dir);
      const holder = createDataHolder({
        db,
        bootDb: { close: async () => {} },
        dataDir: dir,
        version: 'test',
        keyPath,
        cacheDir: dir,
        exportDir: dir,
      });
      const app = createServerApp({ holder });
      const response = await app.request(CONNECT_PATH, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ keyText: DUMMY_KEY, steamId: STEAM_ID }),
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ code: 'INTERNAL', params: {} });
      expect(globalFetch).toHaveBeenCalledTimes(0);
    } finally {
      vi.unstubAllGlobals();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
