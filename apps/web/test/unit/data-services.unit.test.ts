import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listLibrary } from '../../src/data/library.js';
import { readExportGames } from '../../src/data/export.js';
import { getLatestRatedAt, setRating } from '../../src/data/ratings.js';
import { getPrefs, setPrefs } from '../../src/data/viewState.js';

/**
 * D-05 데이터 서비스 테스트. 합성 DB에 제품 SQL을 적용하고
 * 별점·화면상태·목록·내보내기를 확인한다.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freshDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-d05-'));
  const journal = JSON.parse(
    readFileSync(join(WEB, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const setup = new Database(join(dir, 'questail.db'));
  try {
    setup.pragma('journal_mode = WAL');
    for (const entry of journal.entries) {
      setup.exec(readFileSync(join(WEB, 'drizzle', `${entry.tag}.sql`), 'utf8'));
    }
  } finally {
    setup.close();
  }
  return { dir, db: new Database(join(dir, 'questail.db')) };
}

function seedOwned(
  db: Database.Database,
  key: { platform: string; externalId: string },
  origin: string,
  ended: number,
): void {
  db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run(
    key.platform,
    key.externalId,
    'g',
  );
  db.prepare(
    'INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(key.platform, key.externalId, origin, 1700000000, ended, 0);
}

describe('data services', () => {
  it('setRating은 실제 변경만 기록하고 no-op을 구분한다', () => {
    const { db } = freshDb();
    try {
      const key = { platform: 'steam', externalId: '990011' };
      seedOwned(db, key, 'observed', 0);
      expect(setRating(db, key, null)).toEqual({ changed: false, eventId: null });
      const first = setRating(db, key, 8);
      expect(first.changed).toBe(true);
      expect(typeof first.eventId).toBe('number');
      expect(setRating(db, key, 8)).toEqual({ changed: false, eventId: null });
      const cancelled = setRating(db, key, null);
      expect(cancelled.changed).toBe(true);
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM ratings').get() as { n: number },
      ).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });

  it('취소 후 미평가는 평가일이 null이다', () => {
    const { db } = freshDb();
    try {
      const key = { platform: 'steam', externalId: '990011' };
      seedOwned(db, key, 'observed', 0);
      setRating(db, key, 8);
      expect(typeof getLatestRatedAt(db, key)).toBe('number');
      setRating(db, key, null);
      expect(getLatestRatedAt(db, key)).toBeNull();
    } finally {
      db.close();
    }
  });

  it('setRating 범위를 벗어나면 던진다', () => {
    const { db } = freshDb();
    try {
      expect(() => setRating(db, { platform: 'steam', externalId: '1' }, 11 as unknown as 1)).toThrow();
    } finally {
      db.close();
    }
  });

  it('setPrefs는 준 필드만 원자 갱신한다', () => {
    const { db } = freshDb();
    try {
      db.prepare("INSERT INTO games (platform, external_id, name) VALUES ('steam', '1', 'g')").run();
      expect(getPrefs(db, 'ko').locale).toBe('ko');
      setPrefs(db, { locale: 'en' });
      setPrefs(db, { hidden: [{ platform: 'steam', externalId: '1' }] });
      expect(getPrefs(db, 'ko')).toEqual({
        locale: 'en',
        hidden: [{ platform: 'steam', externalId: '1' }],
        sortPerFilter: [],
        hideShortPlaytime: false,
        tbtiWishlist: true,
      });
      setPrefs(db, {
        sortPerFilter: [{ filterKey: 'all', sortKey: 'name', direction: 'asc' }],
      });
      const prefs = getPrefs(db, 'ko');
      expect(prefs.locale).toBe('en');
      expect(prefs.sortPerFilter).toEqual([
        { filterKey: 'all', sortKey: 'name', direction: 'asc' },
      ]);
    } finally {
      db.close();
    }
  });

  it('listLibrary는 정렬 없이 C-1 필드를 싣는다', () => {
    const { db } = freshDb();
    try {
      seedOwned(db, { platform: 'steam', externalId: '990011' }, 'observed', 0);
      seedOwned(db, { platform: 'steam', externalId: '990012' }, 'observed', 1);
      db.prepare(
        "INSERT INTO ratings (platform, external_id, score, updated_at, updated_by) VALUES ('steam', '990011', 8, 1, 'user')",
      ).run();
      const open = listLibrary(db, { includeEnded: false });
      expect(open.map((row) => row.key.externalId)).toEqual(['990011']);
      expect(open[0].latestScore).toBe(8);
      expect(open[0].libraryAddedAt).toBe(1700000000);
      const all = listLibrary(db, { includeEnded: true });
      expect(all.map((row) => row.key.externalId).sort()).toEqual(['990011', '990012']);
    } finally {
      db.close();
    }
  });

  it('readExportGames는 현 보유만 낸다', () => {
    const { db } = freshDb();
    try {
      seedOwned(db, { platform: 'steam', externalId: '990011' }, 'observed', 0);
      seedOwned(db, { platform: 'steam', externalId: '990012' }, 'observed', 1);
      expect(readExportGames(db).map((row) => row.key.externalId)).toEqual(['990011']);
    } finally {
      db.close();
    }
  });
});
