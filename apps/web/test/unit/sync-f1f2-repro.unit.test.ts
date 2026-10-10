import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyncService } from '../../src/data/service.js';
import { resetSyncLocksForTest } from '../../src/data/sync.js';
import { createJobExecutor, setSteamSpyTestHooksForTest } from '../../src/jobs/collect.js';
import { createSteamSpyLimiter } from '@questail/core';
import type { FetchLike } from '../../src/data/connection.js';

/**
 * F1(refresh 집계)·F2(결과 저장 실패 후 ok 종료) 반례 재현 테스트.
 * 가짜 fetch·합성 DB만 쓴다. 실 Steam·SteamSpy 호출 없음.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY = '0123456789abcdef0123456789abcdef';
const SID = '76561197960287930';
const BASE = 'http://127.0.0.1:9/';

function freshDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'questail-f1f2-'));
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

function serviceWith(db: Database.Database, dir: string, fetchFn: FetchLike, seedAccount = true) {
  writeFileSync(join(dir, 'steam.key'), KEY, { mode: 0o600 });
  if (seedAccount) {
    db.prepare('INSERT INTO account (id, steam_id, created_at) VALUES (1, ?, 1)').run(SID);
  }
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

function metaEnvelope(appid: string, name: string): unknown {
  return {
    [appid]: { success: true, data: { name, genres: [{ id: '1', description: 'Action' }] } },
  };
}

function achSuccessBody(): unknown {
  return {
    playerstats: { success: true, achievements: [{ apiname: 'a1', achieved: 1, unlocktime: 5 }] },
  };
}

/** 실행이 끝날 때까지 progress 스냅샷을 모은다. */
async function runAndWatch(
  service: ReturnType<typeof createSyncService>,
  source: 'meta' | 'steamspy' | 'achievements',
  maxIter: number,
): Promise<{ done: number; total: number | null }[]> {
  const seen: { done: number; total: number | null }[] = [];
  for (let i = 0; i < maxIter; i++) {
    const row = service.getSyncStatus().find((entry) => entry.source === source);
    if (row) seen.push({ done: row.progress.done, total: row.progress.total });
    if (row && row.state !== 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return seen;
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

describe('F1 refresh 집계 반례', () => {
  it.each(['meta', 'steamspy', 'achievements'] as const)(
    'F1 %s refresh 3건 전 성공 → 최종 total·itemCount 3·done 3, 진행 중 total 3 고정',
    async (source) => {
      const db = freshDb();
      const dir = mkdtempSync(join(tmpdir(), 'questail-f1f2-'));
      const requested: string[] = [];
      try {
        await withFakeSpyClock(async () => {
          seedGames(db, ['990011', '990012', '990013']);
          if (source === 'achievements') {
            db.prepare(
              "INSERT INTO preferences (key, value, updated_at) VALUES ('achievement_enabled', '1', 1)",
            ).run();
          }
          const fetchFn: FetchLike = async (url: string) => {
            if (url.includes('GetPlayerAchievements')) {
              requested.push(new URL(url).searchParams.get('appid') ?? '?');
              // 수집기보다 폴링이 실행 중 스냅샷을 잡도록 늦춘다(제품 동작 변경 없음).
              await new Promise((resolve) => setTimeout(resolve, 30));
              return { status: 200, json: async () => achSuccessBody() };
            }
            if (url.includes('steamspy.com') || url.includes('/api.php')) {
              const appid = new URL(url).searchParams.get('appid') ?? '?';
              requested.push(appid);
              await new Promise((resolve) => setTimeout(resolve, 30));
              return { status: 200, json: async () => ({ appid: Number(appid), tags: { A: 5 } }) };
            }
            if (url.includes('appdetails')) {
              const appid = new URL(url).searchParams.get('appids') ?? '?';
              requested.push(appid);
              return { status: 200, json: async () => metaEnvelope(appid, `g-${appid}`) };
            }
            return { status: 200, json: async () => ({}) };
          };
          const service = serviceWith(db, dir, fetchFn);
          const runId = service.resyncSource(source, { mode: 'refresh', locale: 'ko' });
          expect(typeof runId).toBe('number');
          const seen = await runAndWatch(service, source, 2400);
          // 실행 큐는 전수 그대로다(3건 모두 요청).
          expect(requested.sort()).toEqual(['990011', '990012', '990013']);
          // 진행 중 보고된 total은 3 고정이다(null = 보고 전).
          const totals = seen.map((snap) => snap.total).filter((total) => total !== null);
          expect(totals.length).toBeGreaterThan(0);
          for (const total of totals) {
            expect(total).toBe(3);
          }
          const entry = service.getSyncStatus().find((row) => row.source === source);
          expect(entry).toMatchObject({ state: 'ok' });
          // done = 그 run 체크포인트 수(종료 시 진행 기록은 삭제되므로 DB로 확인).
          expect(
            db.prepare('SELECT COUNT(*) AS n FROM checkpoints WHERE source = ? AND sync_run_id = ?').get(source, runId),
          ).toEqual({ n: 3 });
          const row = db
            .prepare('SELECT item_count AS c, failed_items AS n FROM sync_runs WHERE id = ?')
            .get(runId) as { c: number; n: number };
          expect(row).toEqual({ c: 3, n: 0 });
        });
      } finally {
        db.close();
        resetSyncLocksForTest();
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it('F1 meta refresh 성공 2 + 실패 1 → total 3·done 2·failedItems 1', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-f1f2-'));
    try {
      seedGames(db, ['990011', '990012', '990013']);
      const fetchFn: FetchLike = async (url: string) => {
        if (!url.includes('appdetails')) return { status: 200, json: async () => ({}) };
        const appid = new URL(url).searchParams.get('appids') ?? '?';
        if (appid === '990012') {
          return { status: 200, json: async () => ({ '990012': { success: false } }) };
        }
        return { status: 200, json: async () => metaEnvelope(appid, `g-${appid}`) };
      };
      const service = serviceWith(db, dir, fetchFn);
      const runId = service.resyncSource('meta', { mode: 'refresh', locale: 'ko' });
      expect(typeof runId).toBe('number');
      const seen = await runAndWatch(service, 'meta', 2400);
      const totals = seen.map((snap) => snap.total).filter((total) => total !== null);
      expect(totals.length).toBeGreaterThan(0);
      for (const total of totals) {
        expect(total).toBe(3);
      }
      const entry = service.getSyncStatus().find((row) => row.source === 'meta');
      expect(entry).toMatchObject({
        state: 'ok',
        failedItems: 1,
        issue: null,
      });
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE source = 'meta' AND sync_run_id = ?").get(runId),
      ).toEqual({ n: 2 });
      const row = db
        .prepare('SELECT item_count AS c, failed_items AS n FROM sync_runs WHERE id = ?')
        .get(runId) as { c: number; n: number };
      expect(row).toEqual({ c: 3, n: 1 });
    } finally {
      db.close();
      resetSyncLocksForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('F2 결과 저장 실패 후 종료 반례', () => {
  it('F2 meta 결과+체크포인트와 failed 재저장 둘 다 실패 → ok 종료 없이 running 유지', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-f1f2-'));
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    try {
      seedGames(db, ['990011']);
      db.exec(
        "CREATE TRIGGER f1f2_abort_meta BEFORE INSERT ON meta_states BEGIN SELECT RAISE(ABORT, 'injected'); END",
      );
      let fetches = 0;
      const fetchFn: FetchLike = async (url: string) => {
        if (!url.includes('appdetails')) return { status: 200, json: async () => ({}) };
        fetches += 1;
        const appid = new URL(url).searchParams.get('appids') ?? '?';
        return { status: 200, json: async () => metaEnvelope(appid, `g-${appid}`) };
      };
      const service = serviceWith(db, dir, fetchFn);
      const runId = service.resyncSource('meta', { locale: 'ko' });
      expect(typeof runId).toBe('number');
      for (let i = 0; i < 600 && fetches === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(fetches).toBe(1);
      // 이중 실패 뒤 끝내기·후속 요청 없이 가라앉을 시간을 둔다.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const entry = service.getSyncStatus().find((row) => row.source === 'meta');
      expect(entry?.state).toBe('running');
      const row = db
        .prepare('SELECT status AS s FROM sync_runs WHERE id = ?')
        .get(runId) as { s: string };
      expect(row).toEqual({ s: 'running' });
      expect(db.prepare('SELECT COUNT(*) AS n FROM meta_states').get()).toEqual({ n: 0 });
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE source = 'meta'").get(),
      ).toEqual({ n: 0 });
      // 원인 로그 1줄: 소스·appid만 싣는다.
      expect(errors.length).toBeGreaterThan(0);
      const logged = errors.map((args) => String(args[0]));
      expect(logged.some((line) => line.includes('meta') && line.includes('990011'))).toBe(true);
      for (const line of logged) {
        expect(line.includes(KEY)).toBe(false);
        expect(line.includes('http')).toBe(false);
      }
    } finally {
      spy.mockRestore();
      db.close();
      resetSyncLocksForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('F2 steamspy 결과+체크포인트와 failed 재저장 둘 다 실패 → ok 종료 없이 running 유지', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-f1f2-'));
    try {
      await withFakeSpyClock(async () => {
        seedGames(db, ['990011']);
        db.exec(
          "CREATE TRIGGER f1f2_abort_tags BEFORE INSERT ON tag_sources BEGIN SELECT RAISE(ABORT, 'injected'); END",
        );
        let fetches = 0;
        const fetchFn: FetchLike = async (url: string) => {
          const appid = new URL(url).searchParams.get('appid') ?? '?';
          fetches += 1;
          return { status: 200, json: async () => ({ appid: Number(appid), tags: { A: 5 } }) };
        };
        const service = serviceWith(db, dir, fetchFn);
        const runId = service.resyncSource('steamspy', { locale: 'ko' });
        expect(typeof runId).toBe('number');
        for (let i = 0; i < 600 && fetches === 0; i++) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(fetches).toBe(1);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const entry = service.getSyncStatus().find((row) => row.source === 'steamspy');
        expect(entry?.state).toBe('running');
        const row = db
          .prepare('SELECT status AS s FROM sync_runs WHERE id = ?')
          .get(runId) as { s: string };
        expect(row).toEqual({ s: 'running' });
        expect(db.prepare('SELECT COUNT(*) AS n FROM tag_sources').get()).toEqual({ n: 0 });
        expect(
          db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE source = 'steamspy'").get(),
        ).toEqual({ n: 0 });
      });
    } finally {
      db.close();
      resetSyncLocksForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('F2 중단 후 새 서비스 recover → 그 항목 1회 재요청·저장·run 정상 종료(stop 미호출)', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-f1f2-'));
    try {
      seedGames(db, ['990011']);
      db.exec(
        "CREATE TRIGGER f1f2_abort_meta BEFORE INSERT ON meta_states BEGIN SELECT RAISE(ABORT, 'injected'); END",
      );
      let fetches = 0;
      const fetchFn: FetchLike = async (url: string) => {
        if (!url.includes('appdetails')) return { status: 200, json: async () => ({}) };
        fetches += 1;
        const appid = new URL(url).searchParams.get('appids') ?? '?';
        return { status: 200, json: async () => metaEnvelope(appid, `g-${appid}`) };
      };
      const service = serviceWith(db, dir, fetchFn);
      const runId = service.resyncSource('meta', { locale: 'ko' });
      expect(typeof runId).toBe('number');
      for (let i = 0; i < 600 && fetches === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(fetches).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(service.getSyncStatus().find((row) => row.source === 'meta')?.state).toBe('running');
      // 장애 제거 + 캐시 비움 → recover가 그 항목을 다시 요청하게 한다. stop()은 호출하지 않는다.
      db.exec('DROP TRIGGER f1f2_abort_meta');
      unlinkSync(join(dir, 'cache', '990011.ko.json'));
      const service2 = serviceWith(db, dir, fetchFn, false);
      await service2.recover();
      for (let i = 0; i < 1200; i++) {
        const done = service2.getSyncStatus().find((row) => row.source === 'meta');
        if (done && done.state !== 'running') break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(fetches).toBe(2);
      const entry = service2.getSyncStatus().find((row) => row.source === 'meta');
      expect(entry).toMatchObject({
        state: 'ok',
        failedItems: 0,
        issue: null,
      });
      const row = db
        .prepare('SELECT status AS s, item_count AS c, failed_items AS n FROM sync_runs WHERE id = ?')
        .get(runId) as { s: string; c: number; n: number };
      expect(row).toEqual({ s: 'ok', c: 1, n: 0 });
      expect(db.prepare("SELECT state AS s FROM meta_states WHERE external_id = '990011'").get()).toEqual({
        s: 'ready',
      });
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE item_key = 'steam:990011:meta'").get(),
      ).toEqual({ n: 1 });
    } finally {
      db.close();
      resetSyncLocksForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
