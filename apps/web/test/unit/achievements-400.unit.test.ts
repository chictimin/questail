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
 * U2 #13A 업적 400 게임 단위 분류 수집 테스트. 합성 DB(제품 SQL) + 가짜 fetch만 쓴다. 실호출 없음.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY = '0123456789abcdef0123456789abcdef';
const SID = '76561197960287930';
const BASE = 'http://127.0.0.1:9/';
const CAPTURE_400 = { playerstats: { error: 'Requested app has no stats', success: false } };
const READY_200 = {
  playerstats: { success: true, achievements: [{ apiname: 'a1', achieved: 1, unlocktime: 5 }] },
};

function freshDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'questail-u2achv-'));
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
  db.prepare("INSERT INTO preferences (key, value, updated_at) VALUES ('achievement_enabled', '1', 1)").run();
}

function serviceWith(
  db: Database.Database,
  dir: string,
  fetchFn: FetchLike,
) {
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

/** appid별 업적 응답 + 그 외 200 빈 응답. */
function achFetch(byAppid: (appid: string) => { status: number; body: unknown }): FetchLike {
  return async (url: string) => {
    if (url.includes('GetPlayerAchievements')) {
      const appid = new URL(url).searchParams.get('appid') ?? '?';
      const r = byAppid(appid);
      return { status: r.status, json: async () => r.body };
    }
    return { status: 200, json: async () => ({}) };
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

function achStateOf(db: Database.Database, externalId: string): string | null {
  const row = db
    .prepare('SELECT state AS s FROM achievement_states WHERE platform = ? AND external_id = ?')
    .get('steam', externalId) as { s: string } | undefined;
  return row ? row.s : null;
}

function achCountOf(db: Database.Database, externalId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM achievements WHERE platform = ? AND external_id = ?')
    .get('steam', externalId) as { n: number };
  return row.n;
}

describe('업적 400 게임 단위 분류', () => {
  it('첫 게임 400 캡처 본문 → 소스 ok·첫 게임 empty·나머지 수집 계속', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-u2achv-'));
    try {
      seedGames(db, ['990011', '990012', '990013']);
      const service = serviceWith(
        db,
        dir,
        achFetch((appid) =>
          appid === '990011' ? { status: 400, body: CAPTURE_400 } : { status: 200, body: READY_200 },
        ),
      );
      service.startSync({ sources: ['achievements'], locale: 'ko' });
      await settled(service);
      const run = service.getSyncStatus().find((row) => row.source === 'achievements');
      expect(run).toMatchObject({ state: 'ok', issue: null });
      expect(achStateOf(db, '990011')).toBe('empty');
      expect(achCountOf(db, '990011')).toBe(0);
      expect(achStateOf(db, '990012')).toBe('ready');
      expect(achStateOf(db, '990013')).toBe('ready');
      expect(achCountOf(db, '990012')).toBe(1);
      expect(achCountOf(db, '990013')).toBe(1);
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE source = 'achievements'").get(),
      ).toEqual({ n: 3 });
    } finally {
      db.close();
      resetSyncLocksForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('400 다른 본문 → 소스 failed NETWORK params.appid', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-u2achv-'));
    try {
      seedGames(db, ['990011']);
      const service = serviceWith(
        db,
        dir,
        achFetch(() => ({
          status: 400,
          body: { playerstats: { error: 'Invalid request', success: false } },
        })),
      );
      service.startSync({ sources: ['achievements'], locale: 'ko' });
      await settled(service);
      const run = service.getSyncStatus().find((row) => row.source === 'achievements');
      expect(run).toMatchObject({
        state: 'failed',
        issue: { code: 'NETWORK', params: { appid: 990011, status: 400 } },
      });
    } finally {
      db.close();
      resetSyncLocksForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('401 → 기존 코드 + appid', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-u2achv-'));
    try {
      seedGames(db, ['990011']);
      const service = serviceWith(
        db,
        dir,
        achFetch(() => ({ status: 401, body: {} })),
      );
      service.startSync({ sources: ['achievements'], locale: 'ko' });
      await settled(service);
      const run = service.getSyncStatus().find((row) => row.source === 'achievements');
      expect(run).toMatchObject({
        state: 'failed',
        issue: { code: 'AUTH_INVALID_KEY', params: { status: 401, appid: 990011 } },
      });
    } finally {
      db.close();
      resetSyncLocksForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('owned 400 → 기존 NETWORK(passStatus 미적용)', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-u2achv-'));
    try {
      seedGames(db, ['990011']);
      const fetchFn: FetchLike = async (url: string) => {
        if (url.includes('GetOwnedGames')) {
          return { status: 400, json: async () => ({}) };
        }
        return { status: 200, json: async () => ({}) };
      };
      const service = serviceWith(db, dir, fetchFn);
      service.startSync({ sources: ['owned'], locale: 'ko' });
      await settled(service);
      const run = service.getSyncStatus().find((row) => row.source === 'owned');
      expect(run).toMatchObject({
        state: 'failed',
        issue: { code: 'NETWORK', params: { status: 400 } },
      });
    } finally {
      db.close();
      resetSyncLocksForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
