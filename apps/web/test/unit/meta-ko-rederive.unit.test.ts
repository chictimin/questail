import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyncService } from '../../src/data/service.js';
import { resetSyncLocksForTest } from '../../src/data/sync.js';
import { createJobExecutor } from '../../src/jobs/collect.js';
import type { FetchLike } from '../../src/data/connection.js';

/**
 * ko 응답 해석 복구 경로(계약 추가 테스트 6). 루프백 baseUrl·합성 dataDir·v3 캐시 파일만 쓴다.
 * meta만 startSync({locale:'ko'}) → ready는 캐시 재파생(fetch 0), failed·캐시 없음은 fetch 1,
 * 닫힌 구간 게임은 큐 밖(fetch 0·값 변경 0).
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY = '0123456789abcdef0123456789abcdef';
const SID = '76561197960287930';
const BASE = 'http://127.0.0.1:9/';

const READY = '71';
const FAILED = '72';
const NO_CACHE = '73';
const CLOSED = '74';

function rawKo(name: string) {
  return {
    name,
    genres: [{ id: '3', description: 'RPG' }],
    release_date: { coming_soon: false, date: '2009년 11월 16일' },
  };
}

function cacheEntry(appId: string) {
  return {
    v: 3,
    appId,
    locale: 'ko',
    fetchedAt: 1700000000,
    notFound: false,
    raw: rawKo(`game-${appId}`),
  };
}

function freshDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'questail-rederive-'));
  const db = new Database(join(dir, 'questail.db'));
  db.pragma('journal_mode = WAL');
  const journal = JSON.parse(
    readFileSync(join(WEB, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  for (const entry of journal.entries) {
    db.exec(readFileSync(join(WEB, 'drizzle', `${entry.tag}.sql`), 'utf8'));
  }
  resetSyncLocksForTest();
  return db;
}

describe('meta ko 재파생(startSync meta)', () => {
  it('ready fetch 0 / failed fetch 1 / 캐시 없음 fetch 1 / 닫힌 구간 큐 밖', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-rederive-dir-'));
    try {
      const cacheDir = join(dir, 'cache');
      mkdirSync(cacheDir, { recursive: true });
      for (const id of [READY, FAILED, CLOSED]) {
        writeFileSync(join(cacheDir, `${id}.ko.json`), JSON.stringify(cacheEntry(id)));
      }
      const insertGame = db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)');
      const insertSpan = db.prepare(
        "INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, ended_at, is_baseline) VALUES ('steam', ?, 'observed', 1, ?, ?, 0)",
      );
      for (const id of [READY, FAILED, NO_CACHE, CLOSED]) {
        insertGame.run('steam', id, `owned-${id}`);
        insertSpan.run(id, id === CLOSED ? 1 : 0, id === CLOSED ? 2 : null);
      }
      db.prepare(
        "INSERT INTO meta_states (platform, external_id, state, observed_at) VALUES ('steam', ?, 'ready', 1), ('steam', ?, 'failed', 1)",
      ).run(READY, FAILED);

      const appdetailsCalls: string[] = [];
      const fetchFn: FetchLike = async (url: string) => {
        if (url.includes('appdetails')) {
          const appid = new URL(url).searchParams.get('appids') ?? '?';
          appdetailsCalls.push(appid);
          return new Response(JSON.stringify({ [appid]: { success: true, data: rawKo(`game-${appid}`) } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      };
      writeFileSync(join(dir, 'steam.key'), KEY, { mode: 0o600 });
      db.prepare('INSERT INTO account (id, steam_id, created_at) VALUES (1, ?, 1)').run(SID);
      const service = createSyncService({
        db,
        keyPath: join(dir, 'steam.key'),
        cacheDir,
        baseUrl: BASE,
        fetchFn,
        timeZone: 'Asia/Seoul',
        storeBaseUrl: BASE,
        executor: (ctx) => createJobExecutor(ctx),
      });
      service.startSync({ sources: ['meta'], locale: 'ko' });
      for (let i = 0; i < 4000; i++) {
        if (service.getSyncStatus().every((row) => row.state !== 'running')) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(service.getSyncStatus().every((row) => row.state !== 'running')).toBe(true);

      expect(appdetailsCalls.filter((id) => id === READY)).toHaveLength(0);
      expect(appdetailsCalls.filter((id) => id === FAILED)).toHaveLength(1);
      expect(appdetailsCalls.filter((id) => id === NO_CACHE)).toHaveLength(1);
      expect(appdetailsCalls.filter((id) => id === CLOSED)).toHaveLength(0);

      const epoch = Date.UTC(2009, 10, 16) / 1000;
      for (const id of [READY, FAILED, NO_CACHE]) {
        expect(
          db.prepare('SELECT release_date, release_date_text FROM games WHERE external_id = ?').get(id),
          id,
        ).toEqual({ release_date: epoch, release_date_text: '2009년 11월 16일' });
        expect(
          db.prepare('SELECT genre_name_ko FROM game_genres WHERE external_id = ? AND genre_id = ?').get(id, '3'),
          id,
        ).toEqual({ genre_name_ko: 'RPG' });
      }
      expect(db.prepare('SELECT release_date, release_date_text FROM games WHERE external_id = ?').get(CLOSED)).toEqual({
        release_date: null,
        release_date_text: null,
      });
      expect(db.prepare('SELECT COUNT(*) AS n FROM game_genres WHERE external_id = ?').get(CLOSED)).toEqual({ n: 0 });
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  }, 30000);
});
