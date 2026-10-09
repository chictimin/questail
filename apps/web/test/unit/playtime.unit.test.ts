import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listReviewObservations, recordPlaytimeSnapshot } from '../../src/data/playtime.js';

/**
 * D-10 스냅샷·검토 대기 테스트. 합성 관측만 쓴다. 실호출 없음.
 * 임시 DB는 mkdtemp 고유 경로에만 둔다.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY = { platform: 'steam', externalId: '990011' };
const TZ = 'Asia/Seoul';

function freshDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-playtime-'));
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
  return { dir, db };
}

function snapshotRows(db: Database.Database): { total: number; review: number; reason: string | null }[] {
  return (
    db
      .prepare(
        'SELECT total_minutes AS total, is_review AS review, review_reason AS reason FROM playtime_snapshots ORDER BY id',
      )
      .all() as { total: number; review: number; reason: string | null }[]
  ).map((row) => ({ total: row.total, review: row.review, reason: row.reason }));
}

describe('recordPlaytimeSnapshot', () => {
  it('첫 관측은 증감 없이 기록한다', () => {
    const { db } = freshDb();
    try {
      const out = recordPlaytimeSnapshot(db, KEY, {
        observedAt: 1700000000,
        observedDay: '2024-01-01',
        timezone: TZ,
        totalMinutes: 100,
        lastPlayed: null,
        playtime2Weeks: 20,
        syncRunId: null,
      });
      expect(out.outcome).toBe('recorded');
      expect(snapshotRows(db)).toEqual([{ total: 100, review: 0, reason: null }]);
      expect(listReviewObservations(db)).toEqual([]);
      const stored = db.prepare('SELECT playtime_2weeks AS w FROM playtime_snapshots').get() as {
        w: number;
      };
      expect(stored.w).toBe(20);
    } finally {
      db.close();
    }
  });

  it('1440분 경계: 같으면 정상·넘으면 spike다', () => {
    for (const [total, outcome] of [
      [100 + 1440, 'recorded'],
      [100 + 1441, 'review'],
    ] as const) {
      const { db } = freshDb();
      try {
        recordPlaytimeSnapshot(db, KEY, {
          observedAt: 1700000000,
          observedDay: '2024-01-01',
          timezone: TZ,
          totalMinutes: 100,
          lastPlayed: null,
          syncRunId: null,
        });
        const out = recordPlaytimeSnapshot(db, KEY, {
          observedAt: 1700000000 + 1440 * 60,
          observedDay: '2024-01-02',
          timezone: TZ,
          totalMinutes: total,
          lastPlayed: null,
          syncRunId: null,
        });
        expect(out.outcome).toBe(outcome);
        if (outcome === 'review') {
          expect(out.kind).toBe('spike');
          expect(listReviewObservations(db)).toHaveLength(1);
        }
      } finally {
        db.close();
      }
    }
  });

  it('2880분 경계도 비례한다', () => {
    const { db } = freshDb();
    try {
      recordPlaytimeSnapshot(db, KEY, {
        observedAt: 1700000000,
        observedDay: '2024-01-01',
        timezone: TZ,
        totalMinutes: 0,
        lastPlayed: null,
        syncRunId: null,
      });
      const ok = recordPlaytimeSnapshot(db, KEY, {
        observedAt: 1700000000 + 2880 * 60,
        observedDay: '2024-01-03',
        timezone: TZ,
        totalMinutes: 2880,
        lastPlayed: null,
        syncRunId: null,
      });
      expect(ok.outcome).toBe('recorded');
      const over = recordPlaytimeSnapshot(db, KEY, {
        observedAt: 1700000000 + 2 * 2880 * 60,
        observedDay: '2024-01-05',
        timezone: TZ,
        totalMinutes: 2880 + 2881,
        lastPlayed: null,
        syncRunId: null,
      });
      expect(over.outcome).toBe('review');
      expect(over.kind).toBe('spike');
    } finally {
      db.close();
    }
  });

  it('음수는 0 절삭 + negative_clamped 관측(절삭 전 값 저장)', () => {
    const { db } = freshDb();
    try {
      recordPlaytimeSnapshot(db, KEY, {
        observedAt: 1700000000,
        observedDay: '2024-01-01',
        timezone: TZ,
        totalMinutes: 200,
        lastPlayed: null,
        syncRunId: null,
      });
      const out = recordPlaytimeSnapshot(db, KEY, {
        observedAt: 1700000600,
        observedDay: '2024-01-02',
        timezone: TZ,
        totalMinutes: 150,
        lastPlayed: null,
        syncRunId: null,
      });
      expect(out).toMatchObject({ outcome: 'review', kind: 'negative_clamped' });
      expect(snapshotRows(db)).toEqual([
        { total: 200, review: 0, reason: null },
        { total: 150, review: 1, reason: 'negative_clamped' },
      ]);
      expect(listReviewObservations(db)).toEqual([
        {
          id: expect.any(Number),
          key: KEY,
          observedAt: 1700000600,
          kind: 'negative_clamped',
          deltaMinutes: -50,
          elapsedSeconds: 600,
          prevObservedAt: 1700000000,
          syncRunId: null,
        },
      ]);
    } finally {
      db.close();
    }
  });

  it('같은 날 두 번째는 불변·same_day다', () => {
    const { db } = freshDb();
    try {
      const first = recordPlaytimeSnapshot(db, KEY, {
        observedAt: 1700000000,
        observedDay: '2024-01-01',
        timezone: TZ,
        totalMinutes: 100,
        lastPlayed: null,
        syncRunId: null,
      });
      const second = recordPlaytimeSnapshot(db, KEY, {
        observedAt: 1700003600,
        observedDay: '2024-01-01',
        timezone: TZ,
        totalMinutes: 9999,
        lastPlayed: null,
        syncRunId: null,
      });
      expect(second).toEqual({ outcome: 'same_day', id: first.id });
      expect(snapshotRows(db)).toEqual([{ total: 100, review: 0, reason: null }]);
      expect(listReviewObservations(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('검토 대기는 관측 시각·id 순으로 읽힌다', () => {
    const { db } = freshDb();
    try {
      recordPlaytimeSnapshot(db, KEY, {
        observedAt: 1700000000,
        observedDay: '2024-01-01',
        timezone: TZ,
        totalMinutes: 100,
        lastPlayed: null,
        syncRunId: null,
      });
      recordPlaytimeSnapshot(db, KEY, {
        observedAt: 1700000600,
        observedDay: '2024-01-02',
        timezone: TZ,
        totalMinutes: 50,
        lastPlayed: null,
        syncRunId: null,
      });
      recordPlaytimeSnapshot(db, KEY, {
        observedAt: 1700087000,
        observedDay: '2024-01-03',
        timezone: TZ,
        totalMinutes: 50 + 2000,
        lastPlayed: null,
        syncRunId: null,
      });
      const list = listReviewObservations(db);
      expect(list.map((row) => row.kind)).toEqual(['negative_clamped', 'spike']);
      expect(list[0].observedAt).toBeLessThan(list[1].observedAt);
    } finally {
      db.close();
    }
  });
});
