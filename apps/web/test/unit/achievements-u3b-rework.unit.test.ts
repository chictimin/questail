import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyncService } from '../../src/data/service.js';
import { resetSyncLocksForTest } from '../../src/data/sync.js';
import { createJobExecutor } from '../../src/jobs/collect.js';
import type { FetchLike } from '../../src/data/connection.js';

/**
 * U3b 보완(U3b-rework) 업적 테스트. 합성 DB(제품 SQL) + 가짜 fetch만 쓴다. 실호출 없음.
 * (a) 저장 트랜잭션 중 예외 → 결과 행·체크포인트 0 (b) 요청 해결 직후 stop → 그 게임 결과 행·체크포인트 0, recover 후 1회 요청
 * (c) 3게임 중 2성공 후 failSource → itemCount 3·failedItems 0·done 2.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY = '0123456789abcdef0123456789abcdef';
const SID = '76561197960287930';
const BASE = 'http://127.0.0.1:9/';

function freshDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'questail-u3b-rework-'));
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
  db.prepare("INSERT INTO preferences (key, value, updated_at) VALUES ('achievement_enabled', '1', 1)").run();
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

function achSuccessBody(): unknown {
  return {
    playerstats: { success: true, achievements: [{ apiname: 'a1', achieved: 1, unlocktime: 5 }] },
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

describe('업적 저장 트랜잭션·stop·실패 집계', () => {
  it('(a) 저장 트랜잭션 중 예외 → 결과 행·체크포인트 0', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-u3b-rework-'));
    try {
      seedGames(db, ['990011']);
      db.exec('DROP TABLE achievements'); // saveCollectedAchievements가 throw한다
      const service = serviceWith(db, dir, async () => ({
        status: 200,
        json: async () => achSuccessBody(),
      }));
      service.startSync({ sources: ['achievements'], locale: 'ko' });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(db.prepare('SELECT COUNT(*) AS n FROM achievement_states').get()).toEqual({ n: 0 });
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE source = 'achievements'").get(),
      ).toEqual({ n: 0 });
      expect(service.getSyncStatus().find((row) => row.source === 'achievements')?.state).toBe(
        'running',
      );
    } finally {
      db.close();
      resetSyncLocksForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(b) 요청 해결 직후 stop → 그 게임 결과 행·체크포인트 0, recover 후 그 게임 1회 요청', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-u3b-rework-'));
    try {
      seedGames(db, ['990011']);
      let phase: 'stop' | 'normal' = 'stop';
      const requested: string[] = [];
      let svc: ReturnType<typeof createSyncService> | null = null;
      const service = serviceWith(db, dir, async (url: string) => {
        if (!url.includes('GetPlayerAchievements')) {
          return { status: 200, json: async () => ({}) };
        }
        requested.push(new URL(url).searchParams.get('appid') ?? '?');
        if (phase === 'stop') {
          void svc?.stop();
        }
        return { status: 200, json: async () => achSuccessBody() };
      });
      svc = service;
      service.startSync({ sources: ['achievements'], locale: 'ko' });
      for (let i = 0; i < 200 && requested.length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(requested).toEqual(['990011']);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(db.prepare('SELECT COUNT(*) AS n FROM achievement_states').get()).toEqual({ n: 0 });
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE source = 'achievements'").get(),
      ).toEqual({ n: 0 });
      expect(service.getSyncStatus().find((row) => row.source === 'achievements')?.state).toBe(
        'running',
      );
      phase = 'normal';
      requested.length = 0;
      const service2 = createSyncService({
        db,
        keyPath: join(dir, 'steam.key'),
        cacheDir: join(dir, 'cache'),
        baseUrl: BASE,
        fetchFn: async (url: string) => {
          if (!url.includes('GetPlayerAchievements')) {
            return { status: 200, json: async () => ({}) };
          }
          requested.push(new URL(url).searchParams.get('appid') ?? '?');
          return { status: 200, json: async () => achSuccessBody() };
        },
        timeZone: 'Asia/Seoul',
        executor: (ctx) => createJobExecutor(ctx),
      });
      await service2.recover();
      await settled(service2);
      expect(requested).toEqual(['990011']);
      expect(db.prepare('SELECT state AS s FROM achievement_states').get()).toEqual({
        s: 'ready',
      });
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE source = 'achievements'").get(),
      ).toEqual({ n: 1 });
    } finally {
      db.close();
      resetSyncLocksForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(c) 3게임 중 2성공 후 failSource → itemCount 3·failedItems 0·done 2', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-u3b-rework-'));
    try {
      seedGames(db, ['990011', '990012', '990013']);
      const service = serviceWith(db, dir, async (url: string) => {
        if (!url.includes('GetPlayerAchievements')) {
          return { status: 200, json: async () => ({}) };
        }
        const appid = new URL(url).searchParams.get('appid') ?? '?';
        if (appid === '990013') {
          return { status: 403, json: async () => ({}) };
        }
        return { status: 200, json: async () => achSuccessBody() };
      });
      const first = service.startSync({ sources: ['achievements'], locale: 'ko' });
      expect(typeof first).toBe('number');
      const runId = first as number;
      await settled(service);
      const row = db
        .prepare('SELECT status AS s, item_count AS c, failed_items AS n FROM sync_runs WHERE id = ?')
        .get(runId) as { s: string; c: number; n: number };
      expect(row).toEqual({ s: 'failed', c: 3, n: 0 });
      expect(
        db
          .prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE source = 'achievements' AND sync_run_id = ?")
          .get(runId),
      ).toEqual({ n: 2 });
    } finally {
      db.close();
      resetSyncLocksForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
