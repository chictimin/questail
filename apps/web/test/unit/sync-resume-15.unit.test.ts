import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyncService } from '../../src/data/service.js';
import { resetSyncLocksForTest, resyncSource } from '../../src/data/sync.js';
import { createJobExecutor, setSteamSpyTestHooksForTest } from '../../src/jobs/collect.js';
import { createSteamSpyLimiter } from '@questail/core';
import type { FetchLike } from '../../src/data/connection.js';

/**
 * U3b #15 뒷부분 테스트. 합성 DB(제품 SQL) + 가짜 fetch/clock만 쓴다. 실호출 없음.
 * (a) 실패 체크포인트 0 (b) resume 복사·재요청 범위 (c) refresh 전체·bypass (d) meta notFound resume bypass
 * (e) 중단 recover 실패 제외·집계 (f) meta 429 중단 finish (g) owned resume 복사 0.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY = '0123456789abcdef0123456789abcdef';
const SID = '76561197960287930';
const BASE = 'http://127.0.0.1:9/';

function freshDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'questail-u3b-'));
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

function serviceWith(
  db: Database.Database,
  dir: string,
  fetchFn: FetchLike,
  now?: () => number,
) {
  writeFileSync(join(dir, 'steam.key'), KEY, { mode: 0o600 });
  db.prepare('INSERT INTO account (id, steam_id, created_at) VALUES (1, ?, 1)').run(SID);
  return createSyncService({
    db,
    keyPath: join(dir, 'steam.key'),
    cacheDir: join(dir, 'cache'),
    baseUrl: BASE,
    fetchFn,
    now,
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

function metaFetch(byAppid: (appid: string) => { status: number; body: unknown }): FetchLike {
  return async (url: string) => {
    if (!url.includes('appdetails')) return { status: 200, json: async () => ({}) };
    const appid = new URL(url).searchParams.get('appids') ?? '?';
    const r = byAppid(appid);
    return { status: r.status, json: async () => r.body };
  };
}

function metaEnvelope(appid: string, name: string): unknown {
  return {
    [appid]: { success: true, data: { name, genres: [{ id: '1', description: 'Action' }] } },
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

function withFakeSpyClock<T>(run: () => Promise<T>): Promise<T> {
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

function fakeNow(base: number): () => number {
  let t = base;
  return () => (t += 5_000);
}

function tagStateOf(db: Database.Database, externalId: string): string | null {
  const row = db
    .prepare('SELECT tag_status AS s FROM tag_sources WHERE platform = ? AND external_id = ?')
    .get('steam', externalId) as { s: string } | undefined;
  return row ? row.s : null;
}

function checkpointsOf(
  db: Database.Database,
  source: string,
): { g: number; k: string; r: number | null }[] {
  return db
    .prepare(
      'SELECT generation AS g, item_key AS k, sync_run_id AS r FROM checkpoints WHERE source = ? ORDER BY item_key',
    )
    .all(source) as { g: number; k: string; r: number | null }[];
}

describe('실패 체크포인트·resume·refresh', () => {
  it('(a)(b) steamspy 1실패 → 체크포인트 0·failed 행, resume는 실패 1건만 요청·성공 복사·새 run done 1', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-u3b-'));
    try {
      await withFakeSpyClock(async () => {
        seedGames(db, ['990011', '990012', '990013']);
        const requested: string[] = [];
        let secondPhase = false;
        const tracking = spyFetch((appid) => {
          requested.push(appid);
          if (appid === '990012' && !secondPhase) {
            return { status: 200, body: { appid: 990012, name: 'x' } };
          }
          return { status: 200, body: { appid: Number(appid), tags: { A: 5 } } };
        });
        const service = serviceWith(db, dir, tracking);
        const first = service.startSync({ sources: ['steamspy'], locale: 'ko' });
        expect(typeof first).toBe('number');
        const run1 = first as number;
        await settled(service);
        // (a)
        expect(tagStateOf(db, '990012')).toBe('failed');
        expect(
          db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE item_key = 'steam:990012:steamspy'").get(),
        ).toEqual({ n: 0 });
        expect(service.getSyncStatus().find((row) => row.source === 'steamspy')).toMatchObject({
          state: 'ok',
          failedItems: 1,
          issue: null,
        });
        // (b) resume
        requested.length = 0;
        secondPhase = true;
        const second = service.resyncSource('steamspy', { mode: 'resume', locale: 'ko' });
        expect(typeof second).toBe('number');
        const run2 = second as number;
        await settled(service);
        expect(requested).toEqual(['990012']);
        expect(checkpointsOf(db, 'steamspy')).toEqual([
          { g: 1, k: 'steam:990011:steamspy', r: run1 },
          { g: 2, k: 'steam:990011:steamspy', r: run1 },
          { g: 2, k: 'steam:990012:steamspy', r: run2 },
          { g: 1, k: 'steam:990013:steamspy', r: run1 },
          { g: 2, k: 'steam:990013:steamspy', r: run1 },
        ]);
        const row = db
          .prepare('SELECT item_count AS c, failed_items AS n FROM sync_runs WHERE id = ?')
          .get(run2) as { c: number; n: number };
        expect(row).toEqual({ c: 1, n: 0 });
        expect(tagStateOf(db, '990012')).toBe('ready');
      });
    } finally {
      db.close();
      resetSyncLocksForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(c) refresh → 전 대상 요청·캐시 bypass·복사 0', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-u3b-'));
    try {
      await withFakeSpyClock(async () => {
        seedGames(db, ['990011', '990012', '990013']);
        const requested: string[] = [];
        const service = serviceWith(
          db,
          dir,
          spyFetch((appid) => {
            requested.push(appid);
            return { status: 200, body: { appid: Number(appid), tags: { Fresh: 5 } } };
          }),
        );
        const first = service.startSync({ sources: ['steamspy'], locale: 'ko' }) as number;
        await settled(service);
        // 캐시를 stale로 덮어쓴다
        writeFileSync(
          join(dir, 'steamspy', '990011.json'),
          JSON.stringify({ v: 1, appId: '990011', fetchedAt: 1, raw: { appid: 990011, tags: { Old: 1 } } }),
          'utf8',
        );
        requested.length = 0;
        const second = service.resyncSource('steamspy', { mode: 'refresh', locale: 'ko' }) as number;
        expect(second).not.toBe(first);
        await settled(service);
        expect(requested.sort()).toEqual(['990011', '990012', '990013']);
        const tags = db
          .prepare("SELECT tag FROM game_user_tags WHERE external_id = '990011'")
          .all() as { tag: string }[];
        expect(tags).toEqual([{ tag: 'Fresh' }]);
        const copied = db
          .prepare('SELECT COUNT(*) AS n FROM checkpoints WHERE generation = 2 AND sync_run_id = ?')
          .get(first) as { n: number };
        expect(copied).toEqual({ n: 0 });
        const gen2 = checkpointsOf(db, 'steamspy').filter((c) => c.g === 2);
        expect(gen2).toHaveLength(3);
        expect(gen2.every((c) => c.r === second)).toBe(true);
      });
    } finally {
      db.close();
      resetSyncLocksForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(d) meta notFound 캐시 failed 항목 resume → 그 appid만 요청', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-u3b-'));
    try {
      seedGames(db, ['990011', '990012']);
      const counts: Record<string, number> = {};
      let secondPhase = false;
      const service = serviceWith(
        db,
        dir,
        metaFetch((appid) => {
          counts[appid] = (counts[appid] ?? 0) + 1;
          if (appid === '990011' && !secondPhase) {
            return { status: 200, body: { '990011': { success: false } } };
          }
          return { status: 200, body: metaEnvelope(appid, `g-${appid}`) };
        }),
        fakeNow(100_000_000),
      );
      service.startSync({ sources: ['meta'], locale: 'ko' });
      await settled(service);
      const failedRow = db
        .prepare("SELECT state AS s FROM meta_states WHERE external_id = '990011'")
        .get() as { s: string };
      expect(failedRow.s).toBe('failed');
      expect(counts).toEqual({ '990011': 1, '990012': 1 });
      for (const k of Object.keys(counts)) counts[k] = 0;
      secondPhase = true;
      service.resyncSource('meta', { mode: 'resume', locale: 'ko' });
      await settled(service);
      expect(counts).toEqual({ '990011': 1, '990012': 0 });
      const readyRow = db
        .prepare("SELECT state AS s FROM meta_states WHERE external_id = '990011'")
        .get() as { s: string };
      expect(readyRow.s).toBe('ready');
    } finally {
      db.close();
      resetSyncLocksForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(e) 중단 recover → 성공·실패 요청 0·나머지 3 성공 시 done 9·failedItems 1·itemCount 10', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-u3b-'));
    try {
      await withFakeSpyClock(async () => {
        const ids = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
        seedGames(db, ids);
        db.exec("INSERT INTO sync_generations (source, generation) VALUES ('steamspy', 1)");
        db.exec(
          "INSERT INTO sync_runs (id, source, status, started_at, observed_day, is_finalized, generation) VALUES (1, 'steamspy', 'running', 1, '2026-10-09', 0, 1)",
        );
        for (const id of ['1', '2', '3', '4', '5', '6']) {
          db.prepare(
            'INSERT INTO checkpoints (generation, source, item_key, done_at, sync_run_id) VALUES (1, ?, ?, 1, 1)',
          ).run('steamspy', `steam:${id}:steamspy`);
        }
        db.prepare(
          "INSERT INTO tag_sources (platform, external_id, tag_status, observed_at, sync_run_id, fail_reason, fail_status) VALUES ('steam', '7', 'failed', 1, 1, 'corrupt', NULL)",
        ).run();
        const requested: string[] = [];
        const service = serviceWith(
          db,
          dir,
          spyFetch((appid) => {
            requested.push(appid);
            return { status: 200, body: { appid: Number(appid), tags: { A: 5 } } };
          }),
        );
        await service.recover();
        await settled(service);
        expect(requested.sort()).toEqual(['10', '8', '9']);
        const run = service.getSyncStatus().find((row) => row.source === 'steamspy');
        expect(run).toMatchObject({ state: 'ok', issue: null });
        const checkpoints = db
          .prepare('SELECT COUNT(*) AS n FROM checkpoints WHERE source = ? AND sync_run_id = 1')
          .get('steamspy') as { n: number };
        expect(checkpoints).toEqual({ n: 9 });
        const row = db
          .prepare('SELECT status AS s, item_count AS c, failed_items AS n FROM sync_runs WHERE id = 1')
          .get() as { s: string; c: number; n: number };
        expect(row).toEqual({ s: 'ok', c: 10, n: 1 });
      });
    } finally {
      db.close();
      resetSyncLocksForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(f) meta 429 중단 시 finish 값이 같은 식', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-u3b-'));
    try {
      seedGames(db, ['990011', '990012', '990013']);
      const requested: string[] = [];
      const service = serviceWith(
        db,
        dir,
        metaFetch((appid) => {
          requested.push(appid);
          if (appid === '990012') return { status: 429, body: {} };
          return { status: 200, body: metaEnvelope(appid, `g-${appid}`) };
        }),
        fakeNow(200_000_000),
      );
      service.startSync({ sources: ['meta'], locale: 'ko' });
      await settled(service);
      expect(requested).toEqual(['990011', '990012']);
      const run = service.getSyncStatus().find((row) => row.source === 'meta');
      expect(run).toMatchObject({
        state: 'failed',
        issue: { code: 'RATE_LIMITED', params: {} },
      });
      const row = db
        .prepare('SELECT item_count AS c, failed_items AS n FROM sync_runs ORDER BY id DESC LIMIT 1')
        .get() as { c: number; n: number };
      expect(row).toEqual({ c: 3, n: 0 });
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE source = 'meta'").get(),
      ).toEqual({ n: 1 });
    } finally {
      db.close();
      resetSyncLocksForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(g) owned resume → 세대 +1·복사 0', async () => {
    const db = freshDb();
    try {
      db.exec("INSERT INTO sync_generations (source, generation) VALUES ('owned', 1)");
      db.prepare(
        'INSERT INTO checkpoints (generation, source, item_key, done_at, sync_run_id) VALUES (1, ?, ?, 1, NULL)',
      ).run('owned', '*');
      const result = resyncSource(db, 'owned', { mode: 'resume', locale: 'ko', timeZone: 'Asia/Seoul' });
      expect(typeof result).toBe('number');
      const gen = db.prepare("SELECT generation AS g FROM sync_generations WHERE source = 'owned'").get() as {
        g: number;
      };
      expect(gen).toEqual({ g: 2 });
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE generation = 2 AND source = 'owned'").get(),
      ).toEqual({ n: 0 });
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });
});
