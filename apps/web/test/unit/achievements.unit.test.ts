import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  saveCollectedAchievements,
  toCollectedAchievements,
} from '../../src/data/achievements.js';

/**
 * D-11 업적 저장 테스트. 합성 업적만 쓴다. 실호출 없음.
 * 임시 DB는 mkdtemp 고유 경로에만 둔다.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY = { platform: 'steam', externalId: '990011' };
const NOW = 1700000000;

function freshDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-achv-'));
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

function achRows(db: Database.Database): { apiname: string; achieved: number; unlocked: number | null }[] {
  return db
    .prepare(
      'SELECT apiname, achieved, unlocked_at AS unlocked FROM achievements WHERE platform = ? AND external_id = ? ORDER BY apiname',
    )
    .all(KEY.platform, KEY.externalId) as { apiname: string; achieved: number; unlocked: number | null }[];
}

function achState(db: Database.Database): string | undefined {
  const row = db
    .prepare('SELECT state AS s FROM achievement_states WHERE platform = ? AND external_id = ?')
    .get(KEY.platform, KEY.externalId) as { s: string } | undefined;
  return row?.s;
}

describe('toCollectedAchievements', () => {
  it('ok 비어있지 않으면 ready다', () => {
    expect(
      toCollectedAchievements({ kind: 'ok' }, [{ apiname: 'a', achieved: true, unlockedAt: 5 }]),
    ).toEqual({ status: 'ready', achievements: [{ apiname: 'a', achieved: true, unlockedAt: 5 }] });
  });

  it('ok 빈 목록과 skipGame은 empty다(리드 해석)', () => {
    expect(toCollectedAchievements({ kind: 'ok' }, [])).toEqual({ status: 'empty' });
    expect(toCollectedAchievements({ kind: 'skipGame' }, [])).toEqual({ status: 'empty' });
  });

  it('failSource는 변환 대상이 아니다', () => {
    expect(() =>
      toCollectedAchievements(
        { kind: 'failSource', code: 'ACCESS_PRIVATE', params: {} } as never,
        [],
      ),
    ).toThrow();
  });
});

describe('saveCollectedAchievements', () => {
  it('ready면 미달성 포함 전건 교체 + ready', () => {
    const { db } = freshDb();
    try {
      db.prepare(
        "INSERT INTO achievements (platform, external_id, apiname, achieved, observed_at) VALUES ('steam', '990011', 'Old', 1, 1)",
      ).run();
      const out = saveCollectedAchievements(
        db,
        KEY,
        {
          status: 'ready',
          achievements: [
            { apiname: 'b', achieved: false, unlockedAt: null },
            { apiname: 'a', achieved: true, unlockedAt: 7 },
          ],
        },
        { observedAt: NOW, syncRunId: null },
      );
      expect(out).toEqual({ status: 'ready' });
      expect(achRows(db)).toEqual([
        { apiname: 'a', achieved: 1, unlocked: 7 },
        { apiname: 'b', achieved: 0, unlocked: null },
      ]);
      expect(achState(db)).toBe('ready');
    } finally {
      db.close();
    }
  });

  it('empty면 행 삭제 + empty', () => {
    const { db } = freshDb();
    try {
      db.prepare(
        "INSERT INTO achievements (platform, external_id, apiname, achieved, observed_at) VALUES ('steam', '990011', 'Old', 1, 1)",
      ).run();
      const out = saveCollectedAchievements(db, KEY, { status: 'empty' }, { observedAt: NOW, syncRunId: null });
      expect(out).toEqual({ status: 'empty' });
      expect(achRows(db)).toEqual([]);
      expect(achState(db)).toBe('empty');
    } finally {
      db.close();
    }
  });

  it('failed면 보존 + failed', () => {
    const { db } = freshDb();
    try {
      db.prepare(
        "INSERT INTO achievements (platform, external_id, apiname, achieved, observed_at) VALUES ('steam', '990011', 'Keep', 0, 1)",
      ).run();
      db.prepare(
        "INSERT INTO achievement_states (platform, external_id, state, observed_at) VALUES ('steam', '990011', 'ready', 1)",
      ).run();
      const out = saveCollectedAchievements(db, KEY, { status: 'failed' }, { observedAt: NOW, syncRunId: null });
      expect(out).toEqual({ status: 'failed' });
      expect(achRows(db)).toEqual([{ apiname: 'Keep', achieved: 0, unlocked: null }]);
      expect(achState(db)).toBe('failed');
    } finally {
      db.close();
    }
  });

  it('중간 실패는 롤백한다', () => {
    const { db } = freshDb();
    try {
      db.prepare(
        "INSERT INTO achievements (platform, external_id, apiname, achieved, observed_at) VALUES ('steam', '990011', 'Keep', 1, 1)",
      ).run();
      expect(() =>
        saveCollectedAchievements(
          db,
          KEY,
          {
            status: 'ready',
            achievements: [
              { apiname: 'Dup', achieved: true, unlockedAt: null },
              { apiname: 'Dup', achieved: false, unlockedAt: null },
            ],
          },
          { observedAt: NOW, syncRunId: null },
        ),
      ).toThrow();
      expect(achRows(db)).toEqual([{ apiname: 'Keep', achieved: 1, unlocked: null }]);
      expect(achState(db)).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
