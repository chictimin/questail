import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listLibrary } from '../../src/data/library.js';
import { listReviewObservations } from '../../src/data/playtime.js';
import {
  getSyncRun,
  listArchivedReviewObservations,
  listGameFacts,
  listWishlistSpans,
} from '../../src/data/archiveRead.js';
import { recordPlaytimeSnapshot } from '../../src/data/playtime.js';

/**
 * D-12 읽기 계약 테스트. 합성 데이터만 쓴다. 실호출 없음.
 * 임시 DB는 mkdtemp 고유 경로에만 둔다.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY = { platform: 'steam', externalId: '990011' };
const NOW = 1700000000;

function freshDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-archive-'));
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

describe('archiveRead', () => {
  it('round-trip: 쓰기→읽기 필드 일치', () => {
    const { db } = freshDb();
    try {
      db.prepare(
        "INSERT INTO tag_sources (platform, external_id, tag_status, observed_at, sync_run_id) VALUES ('steam', '990011', 'empty', ?, NULL)",
      ).run(NOW);
      db.prepare(
        "INSERT INTO ratings (platform, external_id, score, updated_at, updated_by) VALUES ('steam', '990011', 8, ?, 'user')",
      ).run(NOW);
      const facts = listGameFacts(db);
      expect(facts).toEqual(listLibrary(db, { includeEnded: true }));
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({
        key: KEY,
        name: 'g',
        confirmedMinutes: 0,
        tagStatus: 'empty',
        latestScore: 8,
      });
    } finally {
      db.close();
    }
  });

  it('getSyncRun 없음은 null이다', () => {
    const { db } = freshDb();
    try {
      expect(getSyncRun(db, 999)).toBeNull();
    } finally {
      db.close();
    }
  });

  it('getSyncRun은 행을 매핑한다', () => {
    const { db } = freshDb();
    try {
      db.prepare(
        "INSERT INTO sync_runs (source, status, started_at, finished_at, item_count, observed_day, is_finalized, issue_code, issue_params) VALUES ('owned', 'ok', 1, 2, 10, '2026-10-09', 1, 'TAG_EMPTY', '{\"n\":1}')",
      ).run();
      expect(getSyncRun(db, 1)).toEqual({
        id: 1,
        source: 'owned',
        status: 'ok',
        startedAt: 1,
        finishedAt: 2,
        itemCount: 10,
        observedDay: '2026-10-09',
        isFinalized: true,
        issue: { code: 'TAG_EMPTY', params: { n: 1 } },
      });
    } finally {
      db.close();
    }
  });

  it('listReviewObservations 위임은 동일하다', () => {
    const { db } = freshDb();
    try {
      recordPlaytimeSnapshot(db, KEY, {
        observedAt: NOW,
        observedDay: '2024-01-01',
        timezone: 'Asia/Seoul',
        totalMinutes: 100,
        lastPlayed: null,
        syncRunId: null,
      });
      recordPlaytimeSnapshot(db, KEY, {
        observedAt: NOW + 600,
        observedDay: '2024-01-02',
        timezone: 'Asia/Seoul',
        totalMinutes: 40,
        lastPlayed: null,
        syncRunId: null,
      });
      expect(listArchivedReviewObservations(db)).toEqual(listReviewObservations(db));
      expect(listArchivedReviewObservations(db)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('찜 전용 게임은 포함하지 않는다(범위 차이 기록)', () => {
    const { db } = freshDb();
    try {
      db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run(
        'steam',
        '770001',
        'wish-only',
      );
      db.prepare(
        'INSERT INTO wishlist_spans (platform, external_id, first_observed_at, ended) VALUES (?, ?, ?, 0)',
      ).run('steam', '770001', NOW);
      const facts = listGameFacts(db);
      // 보유 구간 없음 → 제외. recap·TBTI가 찜 전용까지 보면 범위 확장 필요.
      expect(facts.map((f) => f.key.externalId)).toEqual(['990011']);
    } finally {
      db.close();
    }
  });

  it('찜 구간은 보유 여부와 무관하게 낱건으로 읽힌다', () => {
    const { db } = freshDb();
    try {
      db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run(
        'steam',
        '770001',
        'wish-only',
      );
      db.prepare(
        'INSERT INTO wishlist_spans (platform, external_id, first_observed_at, ended) VALUES (?, ?, ?, 0)',
      ).run('steam', '770001', NOW);
      db.prepare(
        'INSERT INTO wishlist_spans (platform, external_id, date_added, first_observed_at, priority, observed_at, ended, sync_run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('steam', '990011', 1600000000, NOW - 100, 2, NOW - 50, 1, null);
      const spans = listWishlistSpans(db);
      expect(spans).toEqual([
        {
          key: { platform: 'steam', externalId: '770001' },
          name: 'wish-only',
          titleKo: null,
          dateAdded: null,
          firstObservedAt: NOW,
          priority: null,
          observedAt: null,
          ended: false,
          syncRunId: null,
        },
        {
          key: { platform: 'steam', externalId: '990011' },
          name: 'g',
          titleKo: null,
          dateAdded: 1600000000,
          firstObservedAt: NOW - 100,
          priority: 2,
          observedAt: NOW - 50,
          ended: true,
          syncRunId: null,
        },
      ]);
      // GameFacts 출력 불변.
      expect(listGameFacts(db).map((f) => f.key.externalId)).toEqual(['990011']);
    } finally {
      db.close();
    }
  });
});
