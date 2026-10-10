import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listLibrary } from '../../src/data/library.js';

/**
 * U1 achievementSummary 파생 테스트. 합성 DB(제품 SQL) + 가짜 행만 쓴다.
 * null 규칙: achievementState !== 'ready'이거나 total = 0.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freshDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-u1summary-'));
  const journal = JSON.parse(
    readFileSync(join(WEB, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const setup = new Database(join(dir, 'questail.db'));
  try {
    for (const entry of journal.entries) {
      setup.exec(readFileSync(join(WEB, 'drizzle', `${entry.tag}.sql`), 'utf8'));
    }
  } finally {
    setup.close();
  }
  return { dir, db: new Database(join(dir, 'questail.db')) };
}

const GAME = { platform: 'steam', externalId: '7744' };

function seedGame(db: Database.Database): void {
  db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run(
    GAME.platform,
    GAME.externalId,
    'g',
  );
  db.prepare(
    'INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(GAME.platform, GAME.externalId, 'observed', 1700000000, 0, 0);
}

function seedAchievements(db: Database.Database, achievedFlags: number[]): void {
  achievedFlags.forEach((achieved, index) => {
    db.prepare(
      'INSERT INTO achievements (platform, external_id, apiname, achieved, unlocked_at, observed_at, sync_run_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(GAME.platform, GAME.externalId, `ach_${index}`, achieved, null, 1700000000, null);
  });
}

function seedState(db: Database.Database, state: string): void {
  db.prepare(
    'INSERT INTO achievement_states (platform, external_id, state, observed_at, sync_run_id) VALUES (?, ?, ?, ?, ?)',
  ).run(GAME.platform, GAME.externalId, state, 1700000000, null);
}

function seedEnabled(db: Database.Database, value: string): void {
  db.prepare('INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run(
    'achievement_enabled',
    value,
    1,
  );
}

function summaryOf(db: Database.Database): unknown {
  const facts = listLibrary(db, { includeEnded: true });
  expect(facts).toHaveLength(1);
  return facts[0].achievementSummary;
}

describe('achievementSummary', () => {
  it('ready + 행 3(달성 2) → {achieved:2, total:3}', () => {
    const { dir, db } = freshDb();
    try {
      seedGame(db);
      seedEnabled(db, '1');
      seedState(db, 'ready');
      seedAchievements(db, [1, 1, 0]);
      expect(summaryOf(db)).toEqual({ achieved: 2, total: 3 });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ready + 0행 → null', () => {
    const { dir, db } = freshDb();
    try {
      seedGame(db);
      seedEnabled(db, '1');
      seedState(db, 'ready');
      expect(summaryOf(db)).toBeNull();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('empty + 행 남아 있어도 null', () => {
    const { dir, db } = freshDb();
    try {
      seedGame(db);
      seedEnabled(db, '1');
      seedState(db, 'empty');
      seedAchievements(db, [1, 0]);
      expect(summaryOf(db)).toBeNull();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('failed + 행 남아 있어도 null', () => {
    const { dir, db } = freshDb();
    try {
      seedGame(db);
      seedEnabled(db, '1');
      seedState(db, 'failed');
      seedAchievements(db, [1, 1, 0]);
      expect(summaryOf(db)).toBeNull();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('disabled(행 없음) + 행 남아 있어도 null', () => {
    const { dir, db } = freshDb();
    try {
      seedGame(db);
      seedState(db, 'ready');
      seedAchievements(db, [1, 1, 0]);
      expect(summaryOf(db)).toBeNull();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("disabled('0') + 행 남아 있어도 null", () => {
    const { dir, db } = freshDb();
    try {
      seedGame(db);
      seedEnabled(db, '0');
      seedState(db, 'ready');
      seedAchievements(db, [1, 1, 0]);
      expect(summaryOf(db)).toBeNull();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
