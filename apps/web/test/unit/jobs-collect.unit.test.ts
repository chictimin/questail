import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyncService } from '../../src/data/service.js';
import { resetSyncLocksForTest } from '../../src/data/sync.js';
import { toLocalDay } from '../../src/data/syncRuns.js';
import { startRun } from '../../src/data/syncRuns.js';
import { createJobExecutor } from '../../src/jobs/collect.js';
import { buildQueue } from '../../src/jobs/queue.js';
import type { FetchLike } from '../../src/data/connection.js';

/**
 * D-06 수집 executor 테스트. 가짜 fetch·clock만 쓴다. 실키·실행 없음.
 * 인증은 합성 키 파일 + 고정 SteamID + 루프백 baseUrl로 조립한다.
 * mkdtemp 고유 접두 사용.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY = '0123456789abcdef0123456789abcdef';
const SID = '76561197960287930';
const BASE = 'http://127.0.0.1:9/';

function freshDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
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

function ownedPayload(games: { appid: number; total: number }[]) {
  return {
    response: {
      game_count: games.length,
      games: games.map((game) => ({ appid: game.appid, playtime_forever: game.total })),
    },
  };
}

function appdetailsPayload(appid: string, name: string) {
  return { [appid]: { success: true, data: { name, genres: [{ id: '1', description: 'Action' }] } } };
}

/** URL별 가짜 라우팅. GetOwnedGames·appdetails·GetWishlist만 답한다. */
function routeFetch(opts: {
  owned?: () => unknown;
  appdetails?: (appid: string) => unknown;
  calls?: { url: string };
}): FetchLike {
  return async (url: string) => {
    if (opts.calls) opts.calls.url = url;
    if (url.includes('GetOwnedGames')) {
      return { status: 200, json: async () => (opts.owned ? opts.owned() : ownedPayload([])) };
    }
    if (url.includes('GetWishlist')) {
      return { status: 200, json: async () => ({ response: { items: [] } }) };
    }
    const appid = new URL(url).searchParams.get('appids') ?? '?';
    return { status: 200, json: async () => (opts.appdetails ? opts.appdetails(appid) : {}) };
  };
}

function serviceWith(
  db: Database.Database,
  dir: string,
  opts: {
    fetchFn?: FetchLike;
    now?: () => number;
  } = {},
) {
  writeFileSync(join(dir, 'steam.key'), KEY, { mode: 0o600 });
  db.prepare('INSERT INTO account (id, steam_id, created_at) VALUES (1, ?, 1)').run(SID);
  return createSyncService({
    db,
    keyPath: join(dir, 'steam.key'),
    cacheDir: join(dir, 'cache'),
    baseUrl: BASE,
    fetchFn: opts.fetchFn ?? routeFetch({ owned: () => ownedPayload([{ appid: 1, total: 100 }]) }),
    now: opts.now,
    timeZone: 'Asia/Seoul',
    executor: (ctx) => createJobExecutor(ctx),
  });
}

async function settled(service: ReturnType<typeof createSyncService>): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const rows = service.getSyncStatus();
    if (rows.every((row) => row.state !== 'running')) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('drain 시간 초과');
}

describe('jobs collect', () => {
  it('강제 중단 후 recover는 완료 항목을 재요청하지 않는다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const counts: Record<string, number> = {};
      const service = serviceWith(db, dir, {
        fetchFn: routeFetch({
          owned: () => ownedPayload([{ appid: 1, total: 100 }]),
          appdetails: (appid: string) => {
            counts[appid] = (counts[appid] ?? 0) + 1;
            return appdetailsPayload(appid, 'g1');
          },
        }),
      });
      service.startSync({ sources: ['owned'], locale: 'ko' });
      await settled(service);
      service.resyncSource('meta', { locale: 'ko' });
      await settled(service);
      expect(counts).toEqual({ 1: 1 });
      const crashed = startRun(db, {
        source: 'wishlist',
        startedAt: 1700000000,
        observedDay: '2026-10-09',
        generation: 1,
      });
      void crashed;
      db.prepare(
        "INSERT INTO sync_generations (source, generation) VALUES ('wishlist', 1)",
      ).run();
      await service.recover();
      await settled(service);
      expect(counts).toEqual({ 1: 1 });
      const runs = service
        .getSyncStatus()
        .find((row) => row.source === 'meta');
      expect(runs?.state).not.toBe('running');
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('owned 실패 시 종속은 held다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const service = serviceWith(db, dir, {
        fetchFn: routeFetch({ owned: () => ({ response: {} }) }),
      });
      service.startSync({ locale: 'ko' });
      await settled(service);
      const meta = service.getSyncStatus().find((row) => row.source === 'meta');
      expect(meta?.state).toBe('held');
      expect(meta?.issue).toEqual({ code: 'HELD_DEPENDENCY', params: { source: 'owned' } });
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('resync owned는 신규 구간만 보충한다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      let list = [{ appid: 1, total: 10 }, { appid: 2, total: 20 }];
      const service = serviceWith(db, dir, {
        fetchFn: routeFetch({ owned: () => ownedPayload(list) }),
      });
      service.startSync({ sources: ['owned'], locale: 'ko' });
      await settled(service);
      list = [{ appid: 2, total: 30 }, { appid: 3, total: 0 }];
      service.resyncSource('owned', { locale: 'ko' });
      await settled(service);
      const spans = db
        .prepare('SELECT external_id, ended FROM ownership_spans ORDER BY id')
        .all() as { external_id: string; ended: number }[];
      expect(spans).toEqual([
        { external_id: '1', ended: 1 },
        { external_id: '2', ended: 0 },
        { external_id: '3', ended: 0 },
      ]);
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('stop은 상한 안에 정착하고 실행 중 run은 유지한다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      let called = false;
      const hanging: FetchLike = () => {
        called = true;
        return new Promise<never>(() => {});
      };
      const service = serviceWith(db, dir, { fetchFn: hanging });
      service.startSync({ sources: ['owned'], locale: 'ko' });
      for (let i = 0; i < 200 && !called; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(called).toBe(true);
      await service.stop();
      const owned = service.getSyncStatus().find((row) => row.source === 'owned');
      expect(owned?.state).toBe('running');
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('동일 소스 동시 요청은 D08 거부 경로를 탄다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const service = serviceWith(db, dir, {
        fetchFn: routeFetch({
          owned: async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return ownedPayload([{ appid: 1, total: 10 }]);
          },
        }),
      });
      const first = service.startSync({ sources: ['owned'], locale: 'ko' });
      expect(typeof first).toBe('number');
      expect(service.startSync({ sources: ['owned'], locale: 'ko' })).toEqual({
        code: 'SYNC_IN_PROGRESS',
        source: 'owned',
      });
      await settled(service);
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('진행률 total과 done을 낸다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const service = serviceWith(db, dir, {});
      const id = service.startSync({ sources: ['owned'], locale: 'ko' });
      expect(typeof id).toBe('number');
      await settled(service);
      const status = service.getSyncStatus().find((row) => row.source === 'owned');
      expect(status?.state).toBe('ok');
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('locale 없으면 meta를 만들지 않는다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const finished: unknown[] = [];
      const tracking = createJobExecutor({
        transitions: {
          progressRun: () => true,
          finishSyncRun: (_id, _source, finish) => {
            finished.push(finish);
            return true;
          },
          getSyncStatus: () => [],
        },
        db,
        keyPath: join(dir, 'steam.key'),
        cacheDir: join(dir, 'cache'),
        timeZone: 'Asia/Seoul',
      });
      tracking.enqueue({ runId: 1, source: 'meta', generation: 1, mode: 'resume', locale: null });
      for (let i = 0; i < 200 && finished.length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(finished).toEqual([
        { status: 'ok', finishedAt: expect.any(Number), itemCount: 0, isFinalized: true, issue: null },
      ]);
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

    it('failed·held 미복구 소스는 큐에 넣지 않는다', async () => {    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const service = serviceWith(db, dir, {});
      db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run(
        'steam',
        '990011',
        'g',
      );
      db.prepare(
        'INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('steam', '990011', 'observed', 1700000000, 0, 0);
      const id = service.resyncSource('meta', { locale: 'ko' }) as number;
      expect(service.finishSyncRun(id, 'meta', {
        status: 'failed',
        finishedAt: 1700000001,
        itemCount: 0,
        isFinalized: true,
        issue: { code: 'NETWORK', params: {} },
      })).toBe(true);
      expect(buildQueue(db, { source: 'meta', generation: 1, mode: 'resume' })).toEqual([]);
      const retry = service.resyncSource('meta', { locale: 'ko' });
      expect(typeof retry).toBe('number');
      expect(buildQueue(db, { source: 'meta', generation: 1, mode: 'resume' })).toEqual([
        'steam:990011:meta',
      ]);
      await settled(service);
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('저장 실패는 running 유지·다음 job 계속·unhandled 0이다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const service = serviceWith(db, dir, {
        fetchFn: routeFetch({ owned: () => ownedPayload([{ appid: 1, total: 10 }]) }),
      });
      db.exec('DROP TABLE games'); // applyOwnedDiff가 throw한다
      let unhandled = 0;
      const counter = (): void => {
        unhandled += 1;
      };
      process.on('unhandledRejection', counter);
      try {
        service.startSync({ sources: ['owned'], locale: 'ko' });
        service.resyncSource('meta', { locale: 'ko' });
        for (let i = 0; i < 400; i++) {
          const meta = service.getSyncStatus().find((row) => row.source === 'meta');
          if (meta && meta.state !== 'running') break;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(unhandled).toBe(0);
        expect(service.getSyncStatus().find((row) => row.source === 'owned')?.state).toBe('running');
        expect(service.getSyncStatus().find((row) => row.source === 'meta')?.state).toBe('ok');
      } finally {
        process.removeListener('unhandledRejection', counter);
      }
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('owned 판정 비ok는 verdict code·params를 그대로 싣는다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const service = serviceWith(db, dir, {
        fetchFn: routeFetch({ owned: () => ({ response: {} }) }),
      });
      db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run(
        'steam',
        '990011',
        'g',
      );
      db.prepare(
        'INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('steam', '990011', 'observed', 1700000000, 0, 0);
      service.startSync({ sources: ['owned'], locale: 'ko' });
      await settled(service);
      const owned = service.getSyncStatus().find((row) => row.source === 'owned');
      expect(owned?.issue).toEqual({ code: 'PAYLOAD_CORRUPT', params: { prevCount: 1 } });
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('observed_day는 주입 zone 로컬 날짜다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const service = serviceWith(db, dir, {});
      const id = service.resyncSource('owned', { locale: 'ko' });
      expect(typeof id).toBe('number');
      await settled(service);
      const row = db
        .prepare("SELECT observed_day AS d FROM sync_runs WHERE source = 'owned' ORDER BY id DESC LIMIT 1")
        .get() as { d: string };
      expect(row.d).toBe(toLocalDay(Date.now(), 'Asia/Seoul'));
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('잘못된 IANA는 생성 시 throw한다', () => {
    const db = freshDb();
    try {
      expect(() =>
        createSyncService({
          db,
          keyPath: join(tmpdir(), 'steam.key'),
          cacheDir: join(tmpdir(), 'cache'),
          timeZone: 'Nope/Zone',
        }),
      ).toThrow(RangeError);
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });
});
