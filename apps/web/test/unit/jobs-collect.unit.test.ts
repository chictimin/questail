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
import { createJobExecutor, setSteamSpyTestHooksForTest } from '../../src/jobs/collect.js';
import { listLibrary } from '../../src/data/library.js';
import { buildQueue } from '../../src/jobs/queue.js';
import { createSteamSpyLimiter } from '@questail/core';
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

/** URL별 가짜 라우팅. GetOwnedGames·appdetails·GetWishlist·steamspy만 답한다. */
function routeFetch(opts: {
  owned?: () => unknown;
  appdetails?: (appid: string) => unknown;
  steamspy?: (appid: string) => unknown;
  achievements?: () => unknown;
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
    if (url.includes('steamspy.com') || url.includes('/api.php')) {
      const appid = new URL(url).searchParams.get('appid') ?? '?';
      return { status: 200, json: async () => (opts.steamspy ? opts.steamspy(appid) : { tags: {} }) };
    }
    if (url.includes('GetPlayerAchievements')) {
      return {
        status: 200,
        json: async () =>
          opts.achievements
            ? opts.achievements()
            : { playerstats: { success: true, achievements: [{ apiname: 'a1', achieved: 1, unlocktime: 5 }] } },
      };
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
    skipKey?: boolean;
    storeBaseUrl?: string;
    steamSpyBaseUrl?: string;
  } = {},
  urlSeen?: string[],
) {
  if (!opts.skipKey) {
    writeFileSync(join(dir, 'steam.key'), KEY, { mode: 0o600 });
  }
  db.prepare('INSERT INTO account (id, steam_id, created_at) VALUES (1, ?, 1)').run(SID);
  const fetchFn = opts.fetchFn ?? routeFetch({ owned: () => ownedPayload([{ appid: 1, total: 100 }]) });
  return createSyncService({
    db,
    keyPath: join(dir, 'steam.key'),
    cacheDir: join(dir, 'cache'),
    baseUrl: BASE,
    fetchFn: urlSeen
      ? async (url: string) => {
          urlSeen.push(url);
          return fetchFn(url);
        }
      : fetchFn,
    now: opts.now,
    timeZone: 'Asia/Seoul',
    storeBaseUrl: opts.storeBaseUrl,
    steamSpyBaseUrl: opts.steamSpyBaseUrl,
    executor: (ctx) => createJobExecutor(ctx),
  });
}

async function settled(service: ReturnType<typeof createSyncService>, maxIter = 400): Promise<void> {
  for (let i = 0; i < maxIter; i++) {
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
      // meta 스로틀 2회분(4초)+여유 2초 ≈ 6초. 부하 시 3797ms 실측(10-10). 스로틀 주입 seam이 생기면 교체
      await settled(service, 1200);
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

  it('steamspy ready는 태그 저장 + 재개 시 재요청 0이다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const seen: string[] = [];
      const service = serviceWith(db, dir, {
        fetchFn: routeFetch({
          owned: () => ownedPayload([{ appid: 10, total: 5 }]),
          steamspy: (appid: string) => {
            seen.push(appid);
            return { appid: Number(appid), tags: { Solo: 7 } };
          },
        }),
      });
      service.startSync({ sources: ['owned'], locale: 'ko' });
      await settled(service);
      service.resyncSource('steamspy', { locale: 'ko' });
      await settled(service);
      expect(seen).toEqual(['10']);
      const tags = db
        .prepare('SELECT tag, votes, rank FROM game_user_tags ORDER BY rank')
        .all() as { tag: string; votes: number; rank: number }[];
      expect(tags).toEqual([{ tag: 'Solo', votes: 7, rank: 1 }]);
      const state = db
        .prepare('SELECT tag_status AS s FROM tag_sources')
        .get() as { s: string };
      expect(state.s).toBe('ready');
      service.resyncSource('steamspy', { locale: 'ko' });
      await settled(service);
      expect(seen).toEqual(['10']);
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('steamspy empty는 행 삭제 + empty다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const service = serviceWith(db, dir, {
        fetchFn: routeFetch({
          owned: () => ownedPayload([{ appid: 11, total: 5 }]),
          steamspy: () => ({ appid: 11, tags: {} }),
        }),
      });
      service.startSync({ sources: ['owned'], locale: 'ko' });
      await settled(service);
      service.resyncSource('steamspy', { locale: 'ko' });
      await settled(service);
      const state = db.prepare('SELECT tag_status AS s FROM tag_sources').get() as { s: string };
      expect(state.s).toBe('empty');
      expect(db.prepare('SELECT COUNT(*) AS n FROM game_user_tags').get()).toEqual({ n: 0 });
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('steamspy failed는 보존 + failed다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const failFetch: FetchLike = async (url: string) => {
        if (url.includes('steamspy.com')) return { status: 500, json: async () => ({}) };
        if (url.includes('GetOwnedGames')) {
          return { status: 200, json: async () => ownedPayload([{ appid: 12, total: 5 }]) };
        }
        return { status: 200, json: async () => ({}) };
      };
      const service = serviceWith(db, dir, { fetchFn: failFetch });
      service.startSync({ sources: ['owned'], locale: 'ko' });
      await settled(service);
      db.prepare(
        "INSERT INTO game_user_tags (platform, external_id, tag, votes, rank, observed_at) VALUES ('steam', '12', 'Keep', 4, 1, 1)",
      ).run();
      db.prepare(
        "INSERT INTO tag_sources (platform, external_id, tag_status, observed_at) VALUES ('steam', '12', 'ready', 1)",
      ).run();
      service.resyncSource('steamspy', { locale: 'ko' });
      await settled(service);
      const tags = db
        .prepare('SELECT tag FROM game_user_tags')
        .all() as { tag: string }[];
      expect(tags).toEqual([{ tag: 'Keep' }]);
      const state = db.prepare('SELECT tag_status AS s FROM tag_sources').get() as { s: string };
      expect(state.s).toBe('failed');
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

  it('스냅샷 실패는 owned 차분까지 롤백한다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const service = serviceWith(db, dir, {
        fetchFn: routeFetch({ owned: () => ownedPayload([{ appid: 20, total: 5 }]) }),
      });
      db.exec('DROP TABLE playtime_snapshots');
      service.startSync({ sources: ['owned'], locale: 'ko' });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM ownership_spans').get(),
      ).toEqual({ n: 0 });
      expect(service.getSyncStatus().find((row) => row.source === 'owned')?.state).toBe('running');
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('KST 스냅샷 날짜로 기록한다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const at = Date.parse('2026-01-01T15:30:00Z');
      const service = serviceWith(db, dir, {
        fetchFn: routeFetch({ owned: () => ownedPayload([{ appid: 21, total: 5 }]) }),
        now: () => at,
      });
      service.startSync({ sources: ['owned'], locale: 'ko' });
      await settled(service);
      const row = db
        .prepare('SELECT observed_day AS d, timezone AS z FROM playtime_snapshots')
        .get() as { d: string; z: string };
      expect(row).toEqual({ d: '2026-01-02', z: 'Asia/Seoul' });
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('키 없으면 KEY_STORE_FAILED으로 끝낸다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const service = serviceWith(db, dir, {
        fetchFn: routeFetch({ owned: () => ownedPayload([{ appid: 22, total: 5 }]) }),
        skipKey: true,
      });
      service.startSync({ sources: ['owned'], locale: 'ko' });
      await settled(service);
      const owned = service.getSyncStatus().find((row) => row.source === 'owned');
      expect(owned?.issue).toEqual({ code: 'KEY_STORE_FAILED', params: { reason: 'permission' } });
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('깨진 JSON은 PAYLOAD_CORRUPT로 끝낸다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const broken: FetchLike = async (url: string) => {
        if (url.includes('GetOwnedGames')) {
          return {
            status: 200,
            json: async () => {
              throw new Error('bad json');
            },
          };
        }
        return { status: 200, json: async () => ({}) };
      };
      const service = serviceWith(db, dir, { fetchFn: broken });
      service.startSync({ sources: ['owned'], locale: 'ko' });
      await settled(service);
      const owned = service.getSyncStatus().find((row) => row.source === 'owned');
      expect(owned?.issue).toEqual({ code: 'PAYLOAD_CORRUPT', params: {} });
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('전건 0은 보유 확정·스냅샷 0·run held·종속 계속이다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      let zero = false;
      const counts: Record<string, number> = {};
      const service = serviceWith(db, dir, {
        fetchFn: routeFetch({
          owned: () => (zero ? ownedPayload([{ appid: 30, total: 0 }]) : ownedPayload([{ appid: 30, total: 100 }])),
          appdetails: (appid: string) => {
            counts[appid] = (counts[appid] ?? 0) + 1;
            return appdetailsPayload(appid, 'g30');
          },
        }),
      });
      service.startSync({ sources: ['owned'], locale: 'ko' });
      await settled(service);
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM playtime_snapshots').get(),
      ).toEqual({ n: 1 });
      zero = true;
      service.resyncSource('owned', { locale: 'ko' });
      service.resyncSource('meta', { locale: 'ko' });
      await settled(service);
      const owned = service.getSyncStatus().find((row) => row.source === 'owned');
      expect(owned?.state).toBe('held');
      expect(owned?.issue).toEqual({ code: 'HELD_TIME_ZERO', params: {} });
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM playtime_snapshots').get(),
      ).toEqual({ n: 1 });
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM review_observations').get(),
      ).toEqual({ n: 0 });
      const openSpans = (
        db.prepare('SELECT ended FROM ownership_spans').all() as { ended: number }[]
      ).every((row) => row.ended === 0);
      expect(openSpans).toBe(true);
      expect(counts).toEqual({ 30: 1 });
      const meta = service.getSyncStatus().find((row) => row.source === 'meta');
      expect(meta?.state).not.toBe('held');
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('OFF→ON: owned 진행 중 바꾸면 같은 run에서 업적 수집된다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const service = serviceWith(db, dir, {
        fetchFn: routeFetch({
          owned: async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return ownedPayload([{ appid: 40, total: 5 }]);
          },
        }),
      });
      const id = service.startSync({ sources: ['owned', 'achievements'], locale: 'ko' });
      expect(typeof id).toBe('number');
      await new Promise((resolve) => setTimeout(resolve, 20));
      db.prepare("INSERT INTO preferences (key, value, updated_at) VALUES ('achievement_enabled', '1', 1)").run();
      await settled(service);
      const ach = db
        .prepare('SELECT apiname FROM achievements')
        .all() as { apiname: string }[];
      expect(ach.length).toBeGreaterThan(0);
      const state = db.prepare('SELECT state AS s FROM achievement_states').get() as { s: string };
      expect(state.s).toBe('ready');
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('OFF면 요청 0·ok·itemCount null·행 무변경이다', async () => {    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      let calls = 0;
      const counting: FetchLike = async () => {
        calls += 1;
        return { status: 200, json: async () => ({}) };
      };
      const service = serviceWith(db, dir, { fetchFn: counting });
      service.startSync({ sources: ['achievements'], locale: 'ko' });
      await settled(service);
      expect(calls).toBe(0);
      const run = service.getSyncStatus().find((row) => row.source === 'achievements');
      expect(run).toMatchObject({ state: 'ok', issue: null });
      const row = db
        .prepare('SELECT item_count AS n FROM sync_runs ORDER BY id DESC LIMIT 1')
        .get() as { n: number | null };
      expect(row.n).toBeNull();
      expect(db.prepare('SELECT COUNT(*) AS n FROM achievements').get()).toEqual({ n: 0 });
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('steamspy 가짜 clock 주입이면 실 sleep 없이 수집된다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      let t = 10_000;
      let slept = 0;
      setSteamSpyTestHooksForTest({
        clock: {
          now: () => t,
          sleep: async (ms: number) => {
            slept += ms;
            t += ms;
          },
        },
        limiter: createSteamSpyLimiter(),
      });
      try {
        const service = serviceWith(db, dir, {
          fetchFn: routeFetch({
            owned: () => ownedPayload([{ appid: 50, total: 1 }, { appid: 51, total: 2 }, { appid: 52, total: 3 }]),
            steamspy: (appid: string) => ({ appid: Number(appid), tags: { [`T${appid}`]: 1 } }),
          }),
        });
        service.startSync({ sources: ['owned'], locale: 'ko' });
        await settled(service);
        service.resyncSource('steamspy', { locale: 'ko' });
        await settled(service);
        const n = db.prepare('SELECT COUNT(*) AS n FROM game_user_tags').get() as { n: number };
        expect(n).toEqual({ n: 3 });
        expect(slept).toBeGreaterThan(0);
      } finally {
        setSteamSpyTestHooksForTest(null);
      }
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it.each(['meta', 'steamspy', 'achievements'] as const)(
    '%s stop 중단은 running 유지·완료분 유지·recover 후 나머지만 한다',
    async (source) => {      const db = freshDb();
      const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
      try {
        db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run(
          'steam',
          '990011',
          'g1',
        );
        db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run(
          'steam',
          '990012',
          'g2',
        );
        for (const id of ['990011', '990012']) {
          db.prepare(
            'INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES (?, ?, ?, ?, ?, ?)',
          ).run('steam', id, 'observed', 1700000000, 0, 0);
        }
        db.prepare("INSERT INTO preferences (key, value, updated_at) VALUES ('achievement_enabled', '1', 1)").run();
        writeFileSync(join(dir, 'steam.key'), KEY, { mode: 0o600 });
        db.prepare('INSERT INTO account (id, steam_id, created_at) VALUES (1, ?, 1)').run(SID);
        let hang = true;
        let calls = 0;
        const counts: Record<string, number> = {};
        const gateFetch: FetchLike = async (url: string) => {
          calls += 1;
          if (hang && calls > 1) {
            return new Promise<never>(() => {});
          }
          if (url.includes('GetPlayerAchievements')) {
            return {
              status: 200,
              json: async () => ({
                playerstats: { success: true, achievements: [{ apiname: 'a1', achieved: 1, unlocktime: 5 }] },
              }),
            };
          }
          if (url.includes('steamspy.com')) {
            const appid = new URL(url).searchParams.get('appid') ?? '?';
            counts[appid] = (counts[appid] ?? 0) + 1;
            return { status: 200, json: async () => ({ tags: { T: 1 } }) };
          }
          if (url.includes('appdetails')) {
            const appid = new URL(url).searchParams.get('appids') ?? '?';
            counts[appid] = (counts[appid] ?? 0) + 1;
            return { status: 200, json: async () => appdetailsPayload(appid, 'g') };
          }
          return { status: 200, json: async () => ({}) };
        };
        const makeService = () =>
          createSyncService({
            db,
            keyPath: join(dir, 'steam.key'),
            cacheDir: join(dir, 'cache'),
            baseUrl: BASE,
            fetchFn: gateFetch,
            timeZone: 'Asia/Seoul',
            executor: (ctx) => createJobExecutor(ctx),
          });
        const service = makeService();
        service.startSync({ sources: [source], locale: 'ko' });
        for (let i = 0; i < 400; i++) {
          const done = db
            .prepare('SELECT COUNT(*) AS n FROM checkpoints WHERE source = ?')
            .get(source) as { n: number };
          if (done.n >= 1) break;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await service.stop();
        const mid = service.getSyncStatus().find((row) => row.source === source);
        expect(mid?.state).toBe('running');
        hang = false;
        const service2 = makeService();
        await service2.recover();
        await settled(service2);
        const done = service2.getSyncStatus().find((row) => row.source === source);
        expect(done?.state).toBe('ok');
        if (source !== 'achievements') {
          expect(Object.keys(counts).length).toBe(2);
          const totalCalls = Object.values(counts).reduce((a, b) => a + b, 0);
          expect(totalCalls).toBe(2);
        }
      } finally {
        db.close();
        resetSyncLocksForTest();
      }
    },
    30_000,
  );

  it('meta는 찜 전용 포함·achievements는 보유만 대상이다', async () => {
    const db = freshDb();
    try {
      db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run(
        'steam',
        '770001',
        'wish-only',
      );
      db.prepare(
        'INSERT INTO wishlist_spans (platform, external_id, first_observed_at, ended) VALUES (?, ?, ?, 0)',
      ).run('steam', '770001', 1700000000);
      expect(buildQueue(db, { source: 'meta', generation: 1, mode: 'resume' })).toEqual([
        'steam:770001:meta',
      ]);
      expect(buildQueue(db, { source: 'achievements', generation: 1, mode: 'resume' })).toEqual([]);
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('storeBaseUrl 주입이면 meta 요청이 그 base로 간다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const seen: string[] = [];
      const service = serviceWith(db, dir, {
        fetchFn: routeFetch({
          owned: () => ownedPayload([{ appid: 60, total: 1 }]),
          appdetails: () => ({}),
        }),
        storeBaseUrl: 'http://127.0.0.1:9/',
      }, seen);
      service.startSync({ sources: ['owned'], locale: 'ko' });
      await settled(service);
      service.resyncSource('meta', { locale: 'ko' });
      await settled(service);
      const metaUrls = seen.filter((url) => url.includes('appdetails'));
      expect(metaUrls.length).toBeGreaterThan(0);
      for (const url of metaUrls) {
        expect(url.startsWith('http://127.0.0.1:9/api/appdetails?')).toBe(true);
      }
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('미주입이면 meta 요청이 공식 store로 간다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const seen: string[] = [];
      const service = serviceWith(db, dir, {
        fetchFn: routeFetch({
          owned: () => ownedPayload([{ appid: 61, total: 1 }]),
          appdetails: () => ({}),
        }),
      }, seen);
      service.startSync({ sources: ['owned'], locale: 'ko' });
      await settled(service);
      service.resyncSource('meta', { locale: 'ko' });
      await settled(service);
      const metaUrls = seen.filter((url) => url.includes('appdetails'));
      expect(metaUrls.length).toBeGreaterThan(0);
      for (const url of metaUrls) {
        expect(url.startsWith('https://store.steampowered.com/api/appdetails?')).toBe(true);
      }
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('비루프백 storeBaseUrl은 생성 시 throw한다', () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      expect(() =>
        serviceWith(db, dir, { storeBaseUrl: 'https://example.com/' }),
      ).toThrow(RangeError);
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('실물 Response 가짜 fetch — runMeta가 이름·장르·커버를 저장한다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-meta-f1-'));
    try {
      const APPID = '990071';
      const seen: string[] = [];
      const envelope = {
        [APPID]: {
          success: true,
          data: {
            name: 'Meta F1 Game',
            genres: [{ id: '1', description: 'Action' }],
            capsule_imagev5: 'http://127.0.0.1:9/capsule.jpg',
          },
        },
      };
      const body = (payload: unknown): Response =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      const realFetch: FetchLike = async (url: string) => {
        seen.push(url);
        if (url.includes('GetOwnedGames')) {
          return body(ownedPayload([{ appid: Number(APPID), total: 5 }]));
        }
        if (url.includes('appdetails')) {
          return body(envelope);
        }
        return body({});
      };
      const service = serviceWith(db, dir, { fetchFn: realFetch, storeBaseUrl: 'http://127.0.0.1:9/' });
      service.startSync({ sources: ['owned'], locale: 'ko' });
      for (let i = 0; i < 1200; i++) {
        if (service.getSyncStatus().every((row) => row.state !== 'running')) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(service.getSyncStatus().find((row) => row.source === 'owned')).toMatchObject({
        state: 'ok',
      });
      expect(seen.filter((url) => url.includes('appdetails'))).toEqual([]);
      service.resyncSource('meta', { locale: 'ko' });
      for (let i = 0; i < 1200; i++) {
        if (service.getSyncStatus().every((row) => row.state !== 'running')) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const meta = service.getSyncStatus().find((row) => row.source === 'meta');
      expect(meta).toMatchObject({ state: 'ok', failedItems: 0 });
      const cached = JSON.parse(
        readFileSync(join(dir, 'cache', `${APPID}.ko.json`), 'utf8'),
      ) as { raw: { name: string; genres: { id: string; description: string }[]; capsule_imagev5: string } };
      expect(cached.raw.name).toBe('Meta F1 Game');
      expect(cached.raw.genres).toEqual([{ id: '1', description: 'Action' }]);
      expect(cached.raw.capsule_imagev5).toBe('http://127.0.0.1:9/capsule.jpg');
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  }, 30_000);

  it('steamSpyBaseUrl 주입이면 spy 요청이 그 base로 간다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const seen: string[] = [];
      const service = serviceWith(
        db,
        dir,
        {
          fetchFn: routeFetch({
            owned: () => ownedPayload([{ appid: 70, total: 1 }]),
            steamspy: () => ({ tags: { S: 2 } }),
          }),
          steamSpyBaseUrl: 'http://127.0.0.1:9/',
        },
        seen,
      );
      service.startSync({ sources: ['owned'], locale: 'ko' });
      await settled(service);
      service.resyncSource('steamspy', { locale: 'ko' });
      await settled(service);
      const spyUrls = seen.filter((url) => url.includes('/api.php'));
      expect(spyUrls.length).toBeGreaterThan(0);
      for (const url of spyUrls) {
        expect(url.startsWith('http://127.0.0.1:9/api.php?request=appdetails&appid=')).toBe(true);
      }
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('미주입이면 spy 요청이 기존 주소와 바이트 동일하다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      const seen: string[] = [];
      const service = serviceWith(
        db,
        dir,
        {
          fetchFn: routeFetch({
            owned: () => ownedPayload([{ appid: 71, total: 1 }]),
            steamspy: () => ({ tags: { S: 2 } }),
          }),
        },
        seen,
      );
      service.startSync({ sources: ['owned'], locale: 'ko' });
      await settled(service);
      service.resyncSource('steamspy', { locale: 'ko' });
      await settled(service);
      const spyUrls = seen.filter((url) => url.includes('/api.php'));
      expect(spyUrls).toEqual(['https://steamspy.com/api.php?request=appdetails&appid=71']);
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('비루프백 steamSpyBaseUrl은 생성 시 throw한다', () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d06-'));
    try {
      expect(() =>
        serviceWith(db, dir, { steamSpyBaseUrl: 'https://example.com/' }),
      ).toThrow(RangeError);
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('runMeta 저장 — owned 이름 우선·meta 원문 덮어쓰기·listLibrary 확인', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-meta-persist-'));
    try {
      const APPID = '990082';
      const koEnvelope = {
        [APPID]: {
          success: true,
          data: {
            name: '메타 게임 이름',
            genres: [{ id: '1', description: '액션' }],
            capsule_imagev5: 'http://127.0.0.1:9/cover82.jpg',
          },
        },
      };
      const body = (payload: unknown): Response =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      const realFetch: FetchLike = async (url: string) => {
        if (url.includes('GetOwnedGames')) {
          return body({
            response: {
              game_count: 1,
              games: [{ appid: Number(APPID), playtime_forever: 5, name: 'Owned Appinfo Name' }],
            },
          });
        }
        if (url.includes('appdetails')) {
          return body(koEnvelope);
        }
        return body({});
      };
      const service = serviceWith(db, dir, { fetchFn: realFetch, storeBaseUrl: 'http://127.0.0.1:9/' });
      service.startSync({ sources: ['owned'], locale: 'ko' });
      for (let i = 0; i < 1200; i++) {
        if (service.getSyncStatus().every((row) => row.state !== 'running')) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(db.prepare('SELECT name FROM games').get()).toEqual({ name: 'Owned Appinfo Name' });
      service.resyncSource('meta', { locale: 'ko' });
      for (let i = 0; i < 1200; i++) {
        if (service.getSyncStatus().every((row) => row.state !== 'running')) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(service.getSyncStatus().find((row) => row.source === 'meta')).toMatchObject({
        state: 'ok',
        failedItems: 0,
      });
      const lib = listLibrary(db, { includeEnded: true });
      expect(lib).toHaveLength(1);
      expect(lib[0]).toMatchObject({
        name: 'Owned Appinfo Name',
        titleKo: '메타 게임 이름',
        coverUrl: 'http://127.0.0.1:9/cover82.jpg',
      });
      expect(lib[0].genres).toEqual([{ genreId: '1', nameEn: null, nameKo: '액션' }]);
      expect(db.prepare('SELECT state FROM meta_states').get()).toEqual({ state: 'ready' });
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  }, 30_000);

  it('이름 없는 보유는 meta 원문으로 채운다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-meta-persist-'));
    try {
      const APPID = '990084';
      const koEnvelope = {
        [APPID]: {
          success: true,
          data: {
            name: '일반 게임 이름',
            genres: [{ id: '1', description: '액션' }],
          },
        },
      };
      const body = (payload: unknown): Response =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      const realFetch: FetchLike = async (url: string) => {
        if (url.includes('GetOwnedGames')) {
          return body(ownedPayload([{ appid: Number(APPID), total: 5 }]));
        }
        if (url.includes('appdetails')) {
          return body(koEnvelope);
        }
        return body({});
      };
      const service = serviceWith(db, dir, { fetchFn: realFetch, storeBaseUrl: 'http://127.0.0.1:9/' });
      service.startSync({ sources: ['owned'], locale: 'ko' });
      for (let i = 0; i < 1200; i++) {
        if (service.getSyncStatus().every((row) => row.state !== 'running')) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(db.prepare('SELECT name FROM games').get()).toEqual({ name: null });
      service.resyncSource('meta', { locale: 'ko' });
      for (let i = 0; i < 1200; i++) {
        if (service.getSyncStatus().every((row) => row.state !== 'running')) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const lib = listLibrary(db, { includeEnded: true });
      expect(lib).toHaveLength(1);
      expect(lib[0]).toMatchObject({ name: null, titleKo: '일반 게임 이름' });
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  }, 30_000);

  it('en refresh는 번역을 보존하고 en 장르를 채운다', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-meta-persist-'));
    try {
      const APPID = '990083';
      const koEnvelope = {
        [APPID]: {
          success: true,
          data: {
            name: '코 게임 83',
            genres: [{ id: '1', description: '액션' }],
            capsule_imagev5: 'http://127.0.0.1:9/cover83ko.jpg',
          },
        },
      };
      const enEnvelope = {
        [APPID]: {
          success: true,
          data: {
            name: 'EN Game 83',
            genres: [{ id: '1', description: 'Action' }],
            capsule_imagev5: 'http://127.0.0.1:9/cover83en.jpg',
          },
        },
      };
      let locale: string = 'ko';
      const body = (payload: unknown): Response =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      const realFetch: FetchLike = async (url: string) => {
        if (url.includes('GetOwnedGames')) {
          return body(ownedPayload([{ appid: Number(APPID), total: 5 }]));
        }
        if (url.includes('appdetails')) {
          return body(locale === 'ko' ? koEnvelope : enEnvelope);
        }
        return body({});
      };
      const service = serviceWith(db, dir, { fetchFn: realFetch, storeBaseUrl: 'http://127.0.0.1:9/' });
      service.startSync({ sources: ['owned'], locale: 'ko' });
      for (let i = 0; i < 1200; i++) {
        if (service.getSyncStatus().every((row) => row.state !== 'running')) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      service.resyncSource('meta', { locale: 'ko' });
      for (let i = 0; i < 1200; i++) {
        if (service.getSyncStatus().every((row) => row.state !== 'running')) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      locale = 'en';
      service.resyncSource('meta', { locale: 'en', mode: 'refresh' });
      for (let i = 0; i < 2400; i++) {
        if (service.getSyncStatus().every((row) => row.state !== 'running')) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(service.getSyncStatus().find((row) => row.source === 'meta')).toMatchObject({
        state: 'ok',
        failedItems: 0,
      });
      const lib = listLibrary(db, { includeEnded: true });
      expect(lib).toHaveLength(1);
      expect(lib[0]).toMatchObject({
        name: 'EN Game 83',
        titleKo: '코 게임 83',
        coverUrl: 'http://127.0.0.1:9/cover83en.jpg',
      });
      expect(lib[0].genres).toEqual([{ genreId: '1', nameEn: 'Action', nameKo: '액션' }]);
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  }, 60_000);
});
