import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * D-01 계약 제약 테스트. 동결본 C-1·C-1e 그대로를 마이그레이션 SQL에 적용하고
 * 키·유일·부분유일·FK·계약값 CHECK를 확인한다. 판정·정규화 로직은 범위 밖.
 */
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS = join(DIR, 'drizzle');

function journalTags(): string[] {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  return journal.entries.map((entry) => entry.tag);
}

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    for (const tag of journalTags()) {
      db.exec(readFileSync(join(MIGRATIONS, `${tag}.sql`), 'utf8'));
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function addGame(db: Database.Database): void {
  db.prepare(
    "INSERT INTO games (platform, external_id, name) VALUES ('steam', '990011', 'g')",
  ).run();
}

describe('db constraints (frozen C-1)', () => {
  it('journal 순서대로 SQL을 적용한다', () => {
    expect(journalTags().length).toBeGreaterThan(0);
  });

  it('games 복합 PK 중복을 거부한다', () => {
    const db = freshDb();
    try {
      addGame(db);
      expect(() =>
        db
          .prepare(
            "INSERT INTO games (platform, external_id, name) VALUES ('steam', '990011', 'g2')",
          )
          .run(),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('자식 FK 없이 삽입하면 거부하고 부모 삭제를 제한한다', () => {
    const db = freshDb();
    try {
      expect(() =>
        db
          .prepare(
            'INSERT INTO ownership_spans (platform, external_id, origin, ended, is_baseline) VALUES (?, ?, ?, ?, ?)',
          )
          .run('steam', '990011', 'observed', 0, 0),
      ).toThrow();
      addGame(db);
      db.prepare(
        'INSERT INTO ownership_spans (platform, external_id, origin, ended, is_baseline) VALUES (?, ?, ?, ?, ?)',
      ).run('steam', '990011', 'observed', 0, 0);
      expect(() =>
        db.prepare("DELETE FROM games WHERE external_id = '990011'").run(),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('없는 sync_run을 가리키면 거부한다', () => {
    const db = freshDb();
    try {
      addGame(db);
      expect(() =>
        db
          .prepare(
            'INSERT INTO ownership_spans (platform, external_id, origin, ended, is_baseline, sync_run_id) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run('steam', '990011', 'observed', 0, 0, 999),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('같은 구간 시작 중복과 NULL 시작 2행을 거부한다', () => {
    const db = freshDb();
    try {
      addGame(db);
      const insert = db.prepare(
        'INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES (?, ?, ?, ?, ?, ?)',
      );
      insert.run('steam', '990011', 'observed', 1700000000, 1, 0);
      expect(() =>
        insert.run('steam', '990011', 'observed', 1700000000, 1, 0),
      ).toThrow();
      insert.run('steam', '990011', 'imported', null, 0, 0);
      expect(() => insert.run('steam', '990011', 'imported', null, 0, 0)).toThrow();
    } finally {
      db.close();
    }
  });

  it('열린 구간 2행은 거부하고 닫힌 뒤 새 구간은 허용한다', () => {
    const db = freshDb();
    try {
      addGame(db);
      const insert = db.prepare(
        'INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES (?, ?, ?, ?, ?, ?)',
      );
      insert.run('steam', '990011', 'observed', 1700000000, 0, 1);
      expect(() => insert.run('steam', '990011', 'observed', 1700000001, 0, 0)).toThrow();
      db.prepare('UPDATE ownership_spans SET ended = 1, ended_at = 1700000002').run();
      insert.run('steam', '990011', 'observed', 1700000003, 0, 0);
    } finally {
      db.close();
    }
  });

  it('같은 날 스냅샷 2행을 거부한다', () => {
    const db = freshDb();
    try {
      addGame(db);
      const insert = db.prepare(
        'INSERT INTO playtime_snapshots (platform, external_id, observed_at, observed_day, timezone, total_minutes, is_review) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      insert.run('steam', '990011', 1700000000, '2026-10-09', 'Asia/Seoul', 100, 0);
      expect(() =>
        insert.run('steam', '990011', 1700000001, '2026-10-09', 'Asia/Seoul', 110, 0),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('계약값 CHECK를 강제한다', () => {
    const db = freshDb();
    try {
      addGame(db);
      expect(() =>
        db
          .prepare(
            "INSERT INTO ratings (platform, external_id, score, updated_at, updated_by) VALUES ('steam', '990011', 11, 1, 'user')",
          )
          .run(),
      ).toThrow();
      expect(() =>
        db
          .prepare(
            "INSERT INTO ownership_spans (platform, external_id, origin, ended, is_baseline) VALUES ('steam', '990011', 'stolen', 0, 0)",
          )
          .run(),
      ).toThrow();
      expect(() =>
        db
          .prepare(
            "INSERT INTO sync_runs (source, status, started_at, observed_day, is_finalized) VALUES ('stream', 'ok', 1, '2026-10-09', 1)",
          )
          .run(),
      ).toThrow();
      expect(() =>
        db.prepare("INSERT INTO account (id, created_at) VALUES (2, 1)").run(),
      ).toThrow();
      db.prepare(
        "INSERT INTO import_ledger (kind, kept_count, dropped_count, first_run_at, last_run_at, rerun_blocked) VALUES ('history_jsonl', 1, 0, 1, 1, 1)",
      ).run();
      expect(() =>
        db.prepare(
          "INSERT INTO import_ledger (kind, kept_count, dropped_count, first_run_at, last_run_at, rerun_blocked) VALUES ('history_jsonl', 1, 0, 1, 1, 1)",
        ).run(),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('sync_runs 중복 실행을 거부한다', () => {
    const db = freshDb();
    try {
      const insert = db.prepare(
        "INSERT INTO sync_runs (source, status, started_at, observed_day, is_finalized) VALUES ('owned', 'ok', 1, '2026-10-09', 1)",
      );
      insert.run();
      expect(() => insert.run()).toThrow();
    } finally {
      db.close();
    }
  });
});
