import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PREFS_PATH, createApp } from '../../src/server/app.js';
import { createAttachController } from '../../src/server/attach.js';
import { createDataHolder } from '../../src/server/dataHolder.js';

/**
 * 반례 테스트 (R1-FIX-SRV D16-small ①).
 * PUT /api/prefs sortPerFilter 어휘 가드: filterKey 4종·sortKey 7종·direction 2종 밖이면
 * 400 INVALID_BODY(reason=sortPerFilter) + 쓰기 0. 부착·미부착 동일.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freshDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'questail-zz-prefs-'));
  const journal = JSON.parse(
    readFileSync(join(WEB, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const setup = new Database(join(dir, 'questail.db'));
  try {
    setup.pragma('journal_mode = WAL');
    for (const entry of journal.entries) {
      setup.exec(readFileSync(join(WEB, 'drizzle', `${entry.tag}.sql`), 'utf8'));
    }
  } finally {
    setup.close();
  }
  return new Database(join(dir, 'questail.db'));
}

async function putPrefs(app: ReturnType<typeof createApp>, body: unknown): Promise<Response> {
  return await app.request(`${PREFS_PATH}?fallback=ko`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getSort(app: ReturnType<typeof createApp>): Promise<unknown[]> {
  const res = await app.request(`${PREFS_PATH}?fallback=ko`);
  return ((await res.json()) as { sortPerFilter: unknown[] }).sortPerFilter;
}

const FILTERS = ['all', 'unrated', 'byRating', 'hidden'];
const SORTS = ['playtime', 'lastPlayed', 'rating', 'ratedAt', 'addedAt', 'releaseDate', 'name'];
const DIRS = ['asc', 'desc'];

describe('반례: PUT /api/prefs 어휘 가드', () => {
  it('부착: sortKey bogus → 400 + 저장 0', async () => {
    const db = freshDb();
    try {
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-zz-unused') });
      const res = await putPrefs(app, {
        sortPerFilter: [{ filterKey: 'all', sortKey: 'bogus', direction: 'asc' }],
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: 'INVALID_BODY', params: { reason: 'sortPerFilter' } });
      expect(await getSort(app)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('부착: filterKey bogus → 400 + 저장 0', async () => {
    const db = freshDb();
    try {
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-zz-unused') });
      const res = await putPrefs(app, {
        sortPerFilter: [{ filterKey: 'bogus', sortKey: 'name', direction: 'asc' }],
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: 'INVALID_BODY', params: { reason: 'sortPerFilter' } });
      expect(await getSort(app)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('부착: 14조합 × 4종 전부 200', async () => {
    const db = freshDb();
    try {
      const app = createApp({ db, exportDir: join(tmpdir(), 'questail-zz-unused') });
      for (const filterKey of FILTERS) {
        for (const sortKey of SORTS) {
          for (const direction of DIRS) {
            const res = await putPrefs(app, { sortPerFilter: [{ filterKey, sortKey, direction }] });
            expect([filterKey, sortKey, direction, res.status]).toEqual([filterKey, sortKey, direction, 200]);
          }
        }
      }
    } finally {
      db.close();
    }
  });

  it('미부착: sortKey·filterKey bogus → 400 + 저장 0', async () => {
    const holder = createDataHolder();
    const attach = createAttachController({
      root: join(tmpdir(), 'questail-zz-unused'),
      version: 'zz',
      timeZone: 'Asia/Seoul',
      holder,
      backupDatabase: async () => undefined,
      migrateDatabase: async () => {
        throw new Error('not used');
      },
      registerCron: () => ({ unregister: () => undefined }),
    });
    const app = createApp(undefined, undefined, undefined, undefined, holder, attach);
    for (const body of [
      { sortPerFilter: [{ filterKey: 'all', sortKey: 'bogus', direction: 'asc' }] },
      { sortPerFilter: [{ filterKey: 'bogus', sortKey: 'name', direction: 'asc' }] },
    ]) {
      const res = await putPrefs(app, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: 'INVALID_BODY', params: { reason: 'sortPerFilter' } });
    }
    expect(await getSort(app)).toEqual([]);
  });
});
