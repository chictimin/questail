import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyOwnedDiff } from '../../src/data/ownership.js';
import { applyWishlistDiff } from '../../src/data/wishlist.js';
import { finishRun, startRun } from '../../src/data/syncRuns.js';

/**
 * D-04 수집 차분 테스트. 합성 DB에 제품 SQL을 적용하고
 * 구간·찜·실행 기록을 확인한다. 스냅샷·검토는 D09 범위라 다루지 않는다.
 * 이름은 appinfo 제공분 그대로 쓴다. 네트워크·잡은 범위 밖.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freshDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'questail-d04-'));
  const journal = JSON.parse(
    readFileSync(join(WEB, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const db = new Database(join(dir, 'questail.db'));
  db.pragma('journal_mode = WAL');
  for (const entry of journal.entries) {
    db.exec(readFileSync(join(WEB, 'drizzle', `${entry.tag}.sql`), 'utf8'));
  }
  return db;
}

function game(appid: number, total: number) {
  return { appid, playtimeForever: total, lastPlayed: null, playtime2weeks: null, name: `g${appid}` };
}

const NAMES: Record<number, string> = { 10: 'g10', 20: 'g20' };

const DAY1 = { observedAt: 1700000000, observedDay: '2026-10-09', timezone: 'Asia/Seoul' };
const DAY2 = { observedAt: 1700086400, observedDay: '2026-10-10', timezone: 'Asia/Seoul' };

function count(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe('data collect', () => {
  it('첫 수집은 기준선 구간을 만든다', () => {
    const db = freshDb();
    try {
      const result = applyOwnedDiff(db, {
        verdict: { kind: 'ok' },
        games: [game(1, 100), game(2, 0)],
        clock: DAY1,
        syncRunId: null,
        isFirstCollection: true,
      });
      expect(result).toEqual({ outcome: 'ok', spansOpened: 2, spansClosed: 0 });
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM ownership_spans WHERE is_baseline = 1').get(),
      ).toEqual({ n: 2 });
      expect(count(db, 'playtime_snapshots')).toBe(0);
    } finally {
      db.close();
    }
  });

  it('추가·제거·재보유 구간을 처리한다', () => {
    const db = freshDb();
    try {
      applyOwnedDiff(db, {
        verdict: { kind: 'ok' },
        games: [game(1, 10), game(2, 20)],
        clock: DAY1,
        syncRunId: null,
        isFirstCollection: true,
      });
      const second = applyOwnedDiff(db, {
        verdict: { kind: 'ok' },
        games: [game(2, 30), game(3, 0)],
        clock: DAY2,
        syncRunId: null,
        isFirstCollection: false,
      });
      expect(second.spansOpened).toBe(1);
      expect(second.spansClosed).toBe(1);
      const third = applyOwnedDiff(db, {
        verdict: { kind: 'ok' },
        games: [game(1, 15), game(2, 30), game(3, 0)],
        clock: { observedAt: 1700172800, observedDay: '2026-10-11', timezone: 'Asia/Seoul' },
        syncRunId: null,
        isFirstCollection: false,
      });
      expect(third.spansOpened).toBe(1);
      expect(count(db, 'ownership_spans')).toBe(4);
    } finally {
      db.close();
    }
  });

  it('실패·보류 판정에는 쓰지 않는다', () => {
    const db = freshDb();
    try {
      const failed = applyOwnedDiff(db, {
        verdict: { kind: 'failed', code: 'PAYLOAD_CORRUPT', params: {} },
        games: [game(1, 10)],
        clock: DAY1,
        syncRunId: null,
        isFirstCollection: true,
      });
      expect(failed.outcome).toBe('skipped-verdict');
      expect(count(db, 'ownership_spans')).toBe(0);
      expect(count(db, 'playtime_snapshots')).toBe(0);
    } finally {
      db.close();
    }
  });

  it('전건 시간 0은 보유만 확정한다', () => {
    const db = freshDb();
    try {
      applyOwnedDiff(db, {
        verdict: { kind: 'ok' },
        games: [game(1, 100)],
        clock: DAY1,
        syncRunId: null,
        isFirstCollection: true,
      });
      db.prepare(
        'INSERT INTO playtime_snapshots (platform, external_id, observed_at, observed_day, timezone, total_minutes, is_review) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('steam', '1', 1700000000, '2026-10-09', 'Asia/Seoul', 100, 0);
      const result = applyOwnedDiff(db, {
        verdict: { kind: 'ok' },
        games: [game(1, 0)],
        clock: DAY2,
        syncRunId: null,
        isFirstCollection: false,
      });
      expect(result.outcome).toBe('held-time-zero');
      expect(count(db, 'playtime_snapshots')).toBe(1);
    } finally {
      db.close();
    }
  });

  it('이름 없으면 null로 두고 후속 실이름에 덮어쓴다', () => {
    const db = freshDb();
    try {
      applyOwnedDiff(db, {
        verdict: { kind: 'ok' },
        games: [{ appid: 1, playtimeForever: 10, lastPlayed: null, playtime2weeks: null, name: undefined }],
        clock: DAY1,
        syncRunId: null,
        isFirstCollection: true,
      });
      expect(db.prepare("SELECT name FROM games WHERE external_id = '1'").get()).toEqual({
        name: null,
      });
      applyOwnedDiff(db, {
        verdict: { kind: 'ok' },
        games: [{ appid: 2, playtimeForever: 0, lastPlayed: null, playtime2weeks: null, name: 'g2' }],
        clock: DAY2,
        syncRunId: null,
        isFirstCollection: false,
      });
      expect(db.prepare("SELECT name FROM games WHERE external_id = '2'").get()).toEqual({
        name: 'g2',
      });
    } finally {
      db.close();
    }
  });

  it('수집은 별점을 덮어쓰지 않는다', () => {
    const db = freshDb();
    try {
      db.prepare("INSERT INTO games (platform, external_id, name) VALUES ('steam', '1', 'g')").run();
      db.prepare(
        "INSERT INTO ratings (platform, external_id, score, updated_at, updated_by) VALUES ('steam', '1', 8, 1, 'user')",
      ).run();
      applyOwnedDiff(db, {
        verdict: { kind: 'ok' },
        games: [game(1, 10)],
        clock: DAY1,
        syncRunId: null,
        isFirstCollection: true,
      });
      expect(db.prepare('SELECT score FROM ratings').get()).toEqual({ score: 8 });
    } finally {
      db.close();
    }
  });

  it('찜 추가·해제·재찜과 찜 전용 게임을 처리한다', () => {
    const db = freshDb();
    try {
      const first = applyWishlistDiff(db, {
        verdict: {
          kind: 'ok',
          items: [
            { appid: 10, dateAdded: 1700000000, priority: 1 },
            { appid: 20, dateAdded: null, priority: null },
          ],
        },
        names: NAMES,
        observedAt: 1700000000,
        syncRunId: null,
      });
      expect(first).toEqual({ outcome: 'ok', spansOpened: 2, spansClosed: 0 });
      expect(
        db.prepare("SELECT name FROM games WHERE external_id = '10'").get(),
      ).toEqual({ name: 'g10' });
      const second = applyWishlistDiff(db, {
        verdict: { kind: 'ok', items: [{ appid: 20, dateAdded: null, priority: 2 }] },
        names: NAMES,
        observedAt: 1700086400,
        syncRunId: null,
      });
      expect(second).toEqual({ outcome: 'ok', spansOpened: 0, spansClosed: 1 });
      const fourth = applyWishlistDiff(db, {
        verdict: {
          kind: 'ok',
          items: [
            { appid: 10, dateAdded: 1700000000, priority: 1 },
            { appid: 20, dateAdded: null, priority: 2 },
          ],
        },
        names: NAMES,
        observedAt: 1700172800,
        syncRunId: null,
      });
      expect(fourth.spansOpened).toBe(1);
    } finally {
      db.close();
    }
  });

  it('찜 이름 없으면 null로 둔다', () => {
    const db = freshDb();
    try {
      const result = applyWishlistDiff(db, {
        verdict: { kind: 'ok', items: [{ appid: 10, dateAdded: null, priority: null }] },
        names: {},
        observedAt: 1700000000,
        syncRunId: null,
      });
      expect(result).toEqual({ outcome: 'ok', spansOpened: 1, spansClosed: 0 });
      expect(db.prepare("SELECT name FROM games WHERE external_id = '10'").get()).toEqual({
        name: null,
      });
    } finally {
      db.close();
    }
  });

  it('실행 기록을 시작·종료한다', () => {
    const db = freshDb();
    try {
      const id = startRun(db, { source: 'owned', startedAt: 1700000000, observedDay: '2026-10-09', generation: 1 });
      finishRun(db, id, {
        status: 'ok',
        finishedAt: 1700000001,
        itemCount: 2,
        isFinalized: true,
        issueCode: null,
        issueParams: null,
      });
      const row = db.prepare('SELECT status, is_finalized AS f FROM sync_runs WHERE id = ?').get(id) as {
        status: string;
        f: number;
      };
      expect(row).toEqual({ status: 'ok', f: 1 });
    } finally {
      db.close();
    }
  });
});
