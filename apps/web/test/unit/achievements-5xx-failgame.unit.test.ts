import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyncService } from '../../src/data/service.js';
import { resetSyncLocksForTest } from '../../src/data/sync.js';
import { createJobExecutor } from '../../src/jobs/collect.js';
import { saveCollectedAchievements } from '../../src/data/achievements.js';
import { listLibrary } from '../../src/data/library.js';
import type { FetchLike } from '../../src/data/connection.js';

/**
 * 계약 v1.5.13.5 §3 반례 1~8 — 업적 HTTP 5xx 게임 단위 실패.
 * 합성 DB(제품 SQL) + 가짜 fetch만 쓴다. 실 Steam 호출 없음. 게임 A·B·C 순서.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY = '0123456789abcdef0123456789abcdef';
const SID = '76561197960287930';
const BASE = 'http://127.0.0.1:9/';
const A = '990011';
const B = '990012';
const C = '990013';
const BODY_500 = { playerstats: { error: 'Internal server error', success: false } };
const READY_200 = {
  playerstats: { success: true, achievements: [{ apiname: 'a1', achieved: 1, unlocktime: 5 }] },
};

type Service = ReturnType<typeof createSyncService>;
type Reply = { status: number; body?: unknown; nonJson?: boolean };

function freshDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'questail-ach5xx-'));
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

function seed(db: Database.Database, ids: string[], enabled = true): void {
  for (const id of ids) {
    db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run('steam', id, `g-${id}`);
    db.prepare(
      'INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('steam', id, 'observed', 1700000000, 0, 0);
  }
  db.prepare('INSERT INTO account (id, steam_id, created_at) VALUES (1, ?, 1)').run(SID);
  if (enabled) {
    db.prepare("INSERT INTO preferences (key, value, updated_at) VALUES ('achievement_enabled', '1', 1)").run();
  }
}

function makeService(db: Database.Database, dir: string, fetchFn: FetchLike): Service {
  writeFileSync(join(dir, 'steam.key'), KEY, { mode: 0o600 });
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

/** 업적 요청 appid를 requested에 쌓고 reply가 정한 응답을 돌려준다. */
function fake(requested: string[], reply: (appid: string) => Reply): FetchLike {
  return async (url: string) => {
    if (!url.includes('GetPlayerAchievements')) return { status: 200, json: async () => ({}) };
    const appid = new URL(url).searchParams.get('appid') ?? '?';
    requested.push(appid);
    const r = reply(appid);
    return {
      status: r.status,
      json: async () => {
        if (r.nonJson) throw new SyntaxError('Unexpected token < in JSON');
        return r.body ?? {};
      },
    };
  };
}

async function settled(service: Service): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (service.getSyncStatus().every((row) => row.state !== 'running')) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('drain 시간 초과');
}

function stateOf(db: Database.Database, id: string): string | null {
  const row = db
    .prepare('SELECT state AS s FROM achievement_states WHERE platform = ? AND external_id = ?')
    .get('steam', id) as { s: string } | undefined;
  return row ? row.s : null;
}

function checkpointCount(db: Database.Database, id?: string): number {
  const row = (id === undefined
    ? db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE source = 'achievements'").get()
    : db
        .prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE source = 'achievements' AND item_key = ?")
        .get(`steam:${id}:achievements`)) as { n: number };
  return row.n;
}

function runRow(db: Database.Database, runId: number) {
  return db
    .prepare('SELECT status AS s, item_count AS c, failed_items AS n FROM sync_runs WHERE id = ?')
    .get(runId) as { s: string; c: number | null; n: number | null };
}

function withEnv(body: (db: Database.Database, dir: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-ach5xx-'));
    try {
      await body(db, dir);
    } finally {
      db.close();
      resetSyncLocksForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

describe('업적 5xx 게임 단위 실패 (계약 v1.5.13.5 §3)', () => {
  it(
    '1) B 500 → run ok·failedItems 1·itemCount 3·A·C ready+체크포인트·B failed·B 체크포인트 0',
    withEnv(async (db, dir) => {
      seed(db, [A, B, C]);
      const requested: string[] = [];
      const service = makeService(
        db,
        dir,
        fake(requested, (id) => (id === B ? { status: 500, body: BODY_500 } : { status: 200, body: READY_200 })),
      );
      const runId = service.startSync({ sources: ['achievements'], locale: 'ko' }) as number;
      await settled(service);
      expect(requested).toEqual([A, B, C]);
      expect(runRow(db, runId)).toEqual({ s: 'ok', c: 3, n: 1 });
      expect(service.getSyncStatus().find((r) => r.source === 'achievements')).toMatchObject({
        state: 'ok',
        issue: null,
        failedItems: 1,
      });
      expect(stateOf(db, A)).toBe('ready');
      expect(stateOf(db, B)).toBe('failed');
      expect(stateOf(db, C)).toBe('ready');
      expect(checkpointCount(db, A)).toBe(1);
      expect(checkpointCount(db, B)).toBe(0);
      expect(checkpointCount(db, C)).toBe(1);
    }),
  );

  it(
    '2) 1 직후 resume → B만 요청, B 200이면 ok·failedItems 0',
    withEnv(async (db, dir) => {
      seed(db, [A, B, C]);
      const requested: string[] = [];
      let bStatus = 500;
      const service = makeService(
        db,
        dir,
        fake(requested, (id) =>
          id === B && bStatus === 500 ? { status: 500, body: BODY_500 } : { status: 200, body: READY_200 },
        ),
      );
      service.startSync({ sources: ['achievements'], locale: 'ko' });
      await settled(service);
      requested.length = 0;
      bStatus = 200;
      const runId = service.resyncSource('achievements', { mode: 'resume', locale: 'ko' }) as number;
      await settled(service);
      expect(requested).toEqual([B]);
      expect(runRow(db, runId)).toMatchObject({ s: 'ok', n: 0 });
      expect(stateOf(db, B)).toBe('ready');
    }),
  );

  it(
    '3) B 503 + 비 JSON 본문 → 1과 같은 결과',
    withEnv(async (db, dir) => {
      seed(db, [A, B, C]);
      const requested: string[] = [];
      const service = makeService(
        db,
        dir,
        fake(requested, (id) => (id === B ? { status: 503, nonJson: true } : { status: 200, body: READY_200 })),
      );
      const runId = service.startSync({ sources: ['achievements'], locale: 'ko' }) as number;
      await settled(service);
      expect(requested).toEqual([A, B, C]);
      expect(runRow(db, runId)).toEqual({ s: 'ok', c: 3, n: 1 });
      expect(stateOf(db, B)).toBe('failed');
      expect(stateOf(db, C)).toBe('ready');
      expect(checkpointCount(db, B)).toBe(0);
    }),
  );

  it(
    '4) B 500 뒤 C 429 → run failed·RATE_LIMITED appid C·failedItems 1',
    withEnv(async (db, dir) => {
      seed(db, [A, B, C]);
      const service = makeService(
        db,
        dir,
        fake([], (id) => {
          if (id === B) return { status: 500, body: BODY_500 };
          if (id === C) return { status: 429, body: {} };
          return { status: 200, body: READY_200 };
        }),
      );
      const runId = service.startSync({ sources: ['achievements'], locale: 'ko' }) as number;
      await settled(service);
      expect(runRow(db, runId)).toMatchObject({ s: 'failed', n: 1 });
      expect(service.getSyncStatus().find((r) => r.source === 'achievements')).toMatchObject({
        state: 'failed',
        issue: { code: 'RATE_LIMITED', params: { appid: Number(C) } },
        failedItems: 1,
      });
      expect(stateOf(db, B)).toBe('failed');
    }),
  );

  it(
    '5) J2: 직전 ready(업적 행 2) B가 refresh 중 500 → 원값 보존·state failed·DTO failed·summary null',
    withEnv(async (db, dir) => {
      seed(db, [B]);
      saveCollectedAchievements(
        db,
        { platform: 'steam', externalId: B },
        {
          status: 'ready',
          achievements: [
            { apiname: 'x1', achieved: true, unlockedAt: 111 },
            { apiname: 'x2', achieved: false, unlockedAt: null },
          ],
        },
        { observedAt: 1, syncRunId: null },
      );
      const service = makeService(db, dir, fake([], () => ({ status: 500, body: BODY_500 })));
      service.resyncSource('achievements', { mode: 'refresh', locale: 'ko' });
      await settled(service);
      const rows = db
        .prepare('SELECT apiname, achieved, unlocked_at FROM achievements WHERE platform = ? AND external_id = ? ORDER BY apiname')
        .all('steam', B);
      expect(rows).toEqual([
        { apiname: 'x1', achieved: 1, unlocked_at: 111 },
        { apiname: 'x2', achieved: 0, unlocked_at: null },
      ]);
      expect(stateOf(db, B)).toBe('failed');
      const facts = listLibrary(db, { includeEnded: false }).find((g) => g.key.externalId === B);
      expect(facts?.achievementState).toBe('failed');
      expect(facts?.achievementSummary).toBeNull();
    }),
  );

  it(
    '6) B 404 → 기존대로 소스 실패(NETWORK status 404)·C 요청 0',
    withEnv(async (db, dir) => {
      seed(db, [A, B, C]);
      const requested: string[] = [];
      const service = makeService(
        db,
        dir,
        fake(requested, (id) => (id === B ? { status: 404, body: {} } : { status: 200, body: READY_200 })),
      );
      service.startSync({ sources: ['achievements'], locale: 'ko' });
      await settled(service);
      expect(requested).toEqual([A, B]);
      expect(service.getSyncStatus().find((r) => r.source === 'achievements')).toMatchObject({
        state: 'failed',
        issue: { code: 'NETWORK', params: { appid: Number(B), status: 404 } },
      });
      expect(stateOf(db, B)).toBeNull();
    }),
  );

  it(
    '7) recover: B 500 기록 후 C 요청 중 stop → recover 큐에 B 없음(C만 요청)',
    withEnv(async (db, dir) => {
      seed(db, [A, B, C]);
      const requested: string[] = [];
      let svc: Service | null = null;
      const service = makeService(
        db,
        dir,
        fake(requested, (id) => {
          if (id === B) return { status: 500, body: BODY_500 };
          if (id === C) void svc?.stop();
          return { status: 200, body: READY_200 };
        }),
      );
      svc = service;
      const runId = service.startSync({ sources: ['achievements'], locale: 'ko' }) as number;
      for (let i = 0; i < 200 && !requested.includes(C); i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(runRow(db, runId).s).toBe('running');
      expect(stateOf(db, B)).toBe('failed');
      expect(stateOf(db, C)).toBeNull();
      const requested2: string[] = [];
      const service2 = makeService(db, dir, fake(requested2, () => ({ status: 200, body: READY_200 })));
      await service2.recover();
      await settled(service2);
      expect(requested2).toEqual([C]);
    }),
  );

  it(
    '8) 옵션 OFF run → failed_items NULL 유지(요청 0)',
    withEnv(async (db, dir) => {
      seed(db, [A], false);
      const requested: string[] = [];
      const service = makeService(db, dir, fake(requested, () => ({ status: 200, body: READY_200 })));
      const runId = service.startSync({ sources: ['achievements'], locale: 'ko' }) as number;
      await settled(service);
      expect(requested).toEqual([]);
      expect(runRow(db, runId)).toEqual({ s: 'ok', c: null, n: null });
    }),
  );
});
