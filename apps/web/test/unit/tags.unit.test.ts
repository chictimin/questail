import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listLibrary } from '../../src/data/library.js';
import { saveCollectedTags } from '../../src/data/tags.js';

/**
 * D-17b 태그 저장 테스트. 합성 태그만 쓴다. 실호출 없음.
 * 임시 DB는 mkdtemp 고유 경로에만 둔다.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY = { platform: 'steam', externalId: '990011' };
const NOW = 1700000000;

function freshDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-tags-'));
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
  const db = new Database(join(dir, 'questail.db'));
  db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run(
    KEY.platform,
    KEY.externalId,
    'g',
  );
  db.prepare(
    'INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(KEY.platform, KEY.externalId, 'observed', NOW, 0, 0);
  return { dir, db };
}

function tagRows(db: Database.Database): { tag: string; votes: number; rank: number }[] {
  return db
    .prepare(
      'SELECT tag, votes, rank FROM game_user_tags WHERE platform = ? AND external_id = ? ORDER BY rank',
    )
    .all(KEY.platform, KEY.externalId) as { tag: string; votes: number; rank: number }[];
}

function tagStatus(db: Database.Database): string | undefined {
  const row = db
    .prepare('SELECT tag_status AS s FROM tag_sources WHERE platform = ? AND external_id = ?')
    .get(KEY.platform, KEY.externalId) as { s: string } | undefined;
  return row?.s;
}

describe('saveCollectedTags', () => {
  it('ready면 태그 통째 교체 + ready', () => {
    const { db } = freshDb();
    try {
      db.prepare(
        "INSERT INTO sync_runs (id, source, status, started_at, observed_day, is_finalized) VALUES (3, 'steamspy', 'ok', 1, '2026-10-09', 1)",
      ).run();
      db.prepare(
        "INSERT INTO game_user_tags (platform, external_id, tag, votes, rank, observed_at, sync_run_id) VALUES ('steam', '990011', 'Old', 1, 1, 1, NULL)",
      ).run();
      const out = saveCollectedTags(
        db,
        KEY,
        // core 파생 순서 그대로(투표 내림차순). 저장층은 배열 순서를 rank로 둔다.
        { status: 'ready', tags: [{ tag: 'A', votes: 9 }, { tag: 'B', votes: 5 }] },
        { observedAt: NOW, syncRunId: 3 },
      );
      expect(out).toEqual({ status: 'ready' });
      expect(tagRows(db)).toEqual([
        { tag: 'A', votes: 9, rank: 1 },
        { tag: 'B', votes: 5, rank: 2 },
      ]);
      expect(tagStatus(db)).toBe('ready');
      const meta = db
        .prepare('SELECT observed_at AS o, sync_run_id AS s FROM tag_sources')
        .get() as { o: number; s: number };
      expect(meta).toEqual({ o: NOW, s: 3 });
    } finally {
      db.close();
    }
  });

  it('empty면 태그행 삭제 + empty', () => {
    const { db } = freshDb();
    try {
      db.prepare(
        "INSERT INTO game_user_tags (platform, external_id, tag, votes, rank, observed_at, sync_run_id) VALUES ('steam', '990011', 'Old', 1, 1, 1, NULL)",
      ).run();
      const out = saveCollectedTags(db, KEY, { status: 'empty', tags: [] }, { observedAt: NOW, syncRunId: null });
      expect(out).toEqual({ status: 'empty' });
      expect(tagRows(db)).toEqual([]);
      expect(tagStatus(db)).toBe('empty');
    } finally {
      db.close();
    }
  });

  it('failed면 태그 보존 + failed(observed_at 갱신)', () => {
    const { db } = freshDb();
    try {
      db.prepare(
        "INSERT INTO sync_runs (id, source, status, started_at, observed_day, is_finalized) VALUES (5, 'steamspy', 'ok', 1, '2026-10-09', 1)",
      ).run();
      db.prepare(
        "INSERT INTO game_user_tags (platform, external_id, tag, votes, rank, observed_at, sync_run_id) VALUES ('steam', '990011', 'Keep', 4, 1, 1, NULL)",
      ).run();
      db.prepare(
        "INSERT INTO tag_sources (platform, external_id, tag_status, observed_at, sync_run_id) VALUES ('steam', '990011', 'ready', 1, NULL)",
      ).run();
      const out = saveCollectedTags(db, KEY, { status: 'failed', tags: [] }, { observedAt: NOW, syncRunId: 5 });
      expect(out).toEqual({ status: 'failed' });
      expect(tagRows(db)).toEqual([{ tag: 'Keep', votes: 4, rank: 1 }]);
      expect(tagStatus(db)).toBe('failed');
      const observed = (
        db.prepare('SELECT observed_at AS o FROM tag_sources').get() as { o: number }
      ).o;
      expect(observed).toBe(NOW);
    } finally {
      db.close();
    }
  });

  it('중간 실패는 롤백한다', () => {
    const { db } = freshDb();
    try {
      db.prepare(
        "INSERT INTO game_user_tags (platform, external_id, tag, votes, rank, observed_at, sync_run_id) VALUES ('steam', '990011', 'Keep', 4, 1, 1, NULL)",
      ).run();
      expect(() =>
        saveCollectedTags(
          db,
          KEY,
          { status: 'ready', tags: [{ tag: 'Dup', votes: 1 }, { tag: 'Dup', votes: 2 }] },
          { observedAt: NOW, syncRunId: null },
        ),
      ).toThrow();
      expect(tagRows(db)).toEqual([{ tag: 'Keep', votes: 4, rank: 1 }]);
      expect(tagStatus(db)).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('행 없음은 읽기에서 not_collected다', () => {
    const { db } = freshDb();
    try {
      const facts = listLibrary(db, { includeEnded: false });
      expect(facts).toHaveLength(1);
      expect(facts[0].tagStatus).toBe('not_collected');
      expect(facts[0].tags).toEqual([]);
    } finally {
      db.close();
    }
  });
});
