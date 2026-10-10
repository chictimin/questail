import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyncService } from '../../src/data/service.js';
import { resetSyncLocksForTest } from '../../src/data/sync.js';
import { createJobExecutor, setSteamSpyTestHooksForTest } from '../../src/jobs/collect.js';
import { createSteamSpyLimiter } from '@questail/core';
import type { FetchLike } from '../../src/data/connection.js';

/**
 * U3a #15 runSteamspy failedItems 집계 테스트. 합성 DB(제품 SQL) + 가짜 fetch/clock만 쓴다. 실호출 없음.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY = '0123456789abcdef0123456789abcdef';
const SID = '76561197960287930';
const BASE = 'http://127.0.0.1:9/';

function freshDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'questail-u3aspyrun-'));
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

function seedGames(db: Database.Database, externalIds: string[]): void {
  for (const externalId of externalIds) {
    db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run(
      'steam',
      externalId,
      `g-${externalId}`,
    );
    db.prepare(
      'INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('steam', externalId, 'observed', 1700000000, 0, 0);
  }
}

function serviceWith(db: Database.Database, dir: string, fetchFn: FetchLike) {
  writeFileSync(join(dir, 'steam.key'), KEY, { mode: 0o600 });
  db.prepare('INSERT INTO account (id, steam_id, created_at) VALUES (1, ?, 1)').run(SID);
  return createSyncService({
    db,
    keyPath: join(dir, 'steam.key'),
    cacheDir: join(dir, 'cache'),
    baseUrl: BASE,
    fetchFn,
    timeZone: 'Asia/Seoul',
    executor: (ctx) => createJobExecutor(ctx),
  });
}

function spyFetch(byAppid: (appid: string) => { status: number; body: unknown }): FetchLike {
  return async (url: string) => {
    const appid = new URL(url).searchParams.get('appid') ?? '?';
    const r = byAppid(appid);
    return { status: r.status, json: async () => r.body };
  };
}

async function settled(service: ReturnType<typeof createSyncService>): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const rows = service.getSyncStatus();
    if (rows.every((row) => row.state !== 'running')) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('drain 시간 초과');
}

function withFakeClock<T>(run: () => Promise<T>): Promise<T> {
  let t = 10_000;
  setSteamSpyTestHooksForTest({
    clock: {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
    },
    limiter: createSteamSpyLimiter(),
  });
  return run().finally(() => setSteamSpyTestHooksForTest(null));
}

describe('runSteamspy failedItems', () => {
  it('실패 2건 섞인 run → sync_runs.failed_items 2·entry.failedItems 2', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-u3aspyrun-'));
    try {
      await withFakeClock(async () => {
        seedGames(db, ['990011', '990012', '990013']);
        const service = serviceWith(
          db,
          dir,
          spyFetch((appid) => {
            if (appid === '990011') return { status: 200, body: { appid: 990011, tags: { A: 5 } } };
            if (appid === '990012') return { status: 200, body: { appid: 990012, name: 'x' } };
            return { status: 500, body: {} };
          }),
        );
        service.startSync({ sources: ['steamspy'], locale: 'ko' });
        await settled(service);
        const run = service.getSyncStatus().find((row) => row.source === 'steamspy');
        expect(run).toMatchObject({ state: 'ok', failedItems: 2, issue: null });
        const row = db
          .prepare('SELECT failed_items AS n FROM sync_runs ORDER BY id DESC LIMIT 1')
          .get() as { n: number };
        expect(row.n).toBe(2);
        const statuses = db
          .prepare('SELECT tag_status AS s FROM tag_sources ORDER BY external_id')
          .all() as { s: string }[];
        expect(statuses).toEqual([{ s: 'ready' }, { s: 'failed' }, { s: 'failed' }]);
      });
    } finally {
      db.close();
      resetSyncLocksForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('저장 예외 경로도 실패로 센다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-u3aspyrun-'));
    try {
      await withFakeClock(async () => {
        seedGames(db, ['990011', '990012']);
        db.exec(
          "CREATE TRIGGER u3a_abort_tags BEFORE INSERT ON game_user_tags WHEN NEW.external_id = '990012' BEGIN SELECT RAISE(ABORT, 'injected'); END",
        );
        const service = serviceWith(
          db,
          dir,
          spyFetch((appid) => ({ status: 200, body: { appid: Number(appid), tags: { A: 5 } } })),
        );
        service.startSync({ sources: ['steamspy'], locale: 'ko' });
        await settled(service);
        const run = service.getSyncStatus().find((row) => row.source === 'steamspy');
        expect(run).toMatchObject({ state: 'ok', failedItems: 1, issue: null });
        const row = db
          .prepare('SELECT failed_items AS n FROM sync_runs ORDER BY id DESC LIMIT 1')
          .get() as { n: number };
        expect(row.n).toBe(1);
      });
    } finally {
      db.close();
      resetSyncLocksForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
