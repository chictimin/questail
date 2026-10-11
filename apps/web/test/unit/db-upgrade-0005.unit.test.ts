import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveForLocale } from '@questail/core';
import { migrateDatabase } from '../../src/db/migrate.js';
import { saveCollectedMeta } from '../../src/data/meta.js';

/**
 * 제품 0005(ko 출시일 백필) 회귀. 합성 DB·루프백 없음(fetch 0).
 * 0000~0004는 분리 폴더에 복사해 먼저 적용하고, 0005는 제품 폴더(pending 1건)로 적용한다.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DRIZZLE = join(WEB, 'drizzle');
const TAG_0005 = '0005_release_date_ko_backfill';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'questail-0005-'));
}

function journalEntries(): { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[] {
  return (JSON.parse(readFileSync(join(DRIZZLE, 'meta', '_journal.json'), 'utf8')) as {
    entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
  }).entries;
}

/** 0000~0004만 가진 폴더(저널은 제품 저널의 앞 5건 그대로). */
function folderUpTo0004(dir: string): string {
  const folder = join(dir, 'upto0004');
  mkdirSync(join(folder, 'meta'), { recursive: true });
  const entries = journalEntries().filter((entry) => entry.idx <= 4);
  for (const entry of entries) {
    copyFileSync(join(DRIZZLE, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'sqlite', entries }),
  );
  return folder;
}

const FILLED: string[] = [
  '2009년 11월 16일',
  '2009년 1월 9일',
  '2009년11월16일',
  '2009년 2월 31일',
  '  2009년 3월 5일  ',
  '2009년 02월 09일',
  '2024년 2월 29일',
  '2100년 2월 29일',
  '0100년 1월 1일',
  '1970년 1월 1일',
  '1969년 12월 31일',
  '9999년 12월 31일',
];

const NOT_FILLED: string[] = [
  '2026년',
  '2026년 3월',
  '',
  '발표 예정',
  'Oct 10, 2007',
  '10 Oct, 2007',
  '2009년 13월 1일',
  '2009년 0월 1일',
  '2009년 1월 0일',
  '2009년 1월 32일',
  '2009년 100월 1일',
  '0099년 1월 1일',
  '0000년 1월 1일',
  '2009년\t1월 1일',
  '2009년 1월 1일',
  'x2009년 1월 1일',
  '2009년 1월 1일x',
  '2009년 1월 1일 일',
];

function koEpochViaProduct(texts: string[]): Map<string, number | null> {
  const dir = tmpDir();
  const db = new Database(join(dir, 'questail.db'));
  try {
    for (const entry of journalEntries()) {
      db.exec(readFileSync(join(DRIZZLE, `${entry.tag}.sql`), 'utf8'));
    }
    const run = db
      .prepare(
        "INSERT INTO sync_runs (source, status, started_at, observed_day, is_finalized) VALUES ('meta', 'running', 1, '2026-10-09', 0) RETURNING id",
      )
      .get() as { id: number };
    const out = new Map<string, number | null>();
    texts.forEach((text, index) => {
      const id = String(1000 + index);
      db.prepare('INSERT INTO games (platform, external_id) VALUES (?, ?)').run('steam', id);
      const meta = deriveForLocale(
        { name: 'X', release_date: { date: text } } as never,
        'ko',
        id,
      );
      saveCollectedMeta(db, { platform: 'steam', externalId: id }, { meta, state: 'ready', fromCache: false }, {
        locale: 'ko',
        observedAt: 1,
        syncRunId: run.id,
      });
      const row = db.prepare('SELECT release_date FROM games WHERE external_id = ?').get(id) as {
        release_date: number | null;
      };
      out.set(text, row.release_date);
    });
    return out;
  } finally {
    db.close();
  }
}

async function seedAt0004(dir: string, texts: string[]): Promise<void> {
  const first = await migrateDatabase(dir, folderUpTo0004(dir));
  try {
    const insert = first.db.prepare(
      'INSERT INTO games (platform, external_id, name, release_date, release_date_text) VALUES (?, ?, ?, ?, ?)',
    );
    texts.forEach((text, index) => insert.run('steam', String(1000 + index), `g${index}`, null, text));
  } finally {
    await first.close();
  }
}

function dumpGames(dir: string): unknown[] {
  const db = new Database(join(dir, 'questail.db'), { readonly: true });
  try {
    return db.prepare('SELECT * FROM games ORDER BY external_id').all();
  } finally {
    db.close();
  }
}

function migrationCount(dir: string): number {
  const db = new Database(join(dir, 'questail.db'), { readonly: true });
  try {
    return (db.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as { n: number }).n;
  } finally {
    db.close();
  }
}

describe('db upgrade 0005', () => {
  it('저널 마지막 항목이 0005이고 0004까지 적용된 DB에서 업그레이드된다', async () => {
    expect(journalEntries().at(-1)?.tag).toBe(TAG_0005);
    const dir = tmpDir();
    await seedAt0004(dir, ['2009년 11월 16일']);
    expect(migrationCount(dir)).toBe(5);
    const handle = await migrateDatabase(dir, DRIZZLE);
    try {
      const row = handle.db.prepare('SELECT release_date FROM games').get() as { release_date: number };
      expect(row.release_date).toBe(Date.UTC(2009, 10, 16) / 1000);
    } finally {
      await handle.close();
    }
    expect(migrationCount(dir)).toBe(6);
  });

  it('ko 형식 NULL 행만 채우고 값은 제품 경로(파서+저장) 결과와 같다', async () => {
    const dir = tmpDir();
    const texts = [...FILLED, ...NOT_FILLED];
    await seedAt0004(dir, texts);
    // 이미 정수가 있는 행·원문 NULL 행·en 형식 행
    const extra = new Database(join(dir, 'questail.db'));
    extra
      .prepare('INSERT INTO games (platform, external_id, name, release_date, release_date_text) VALUES (?, ?, ?, ?, ?)')
      .run('steam', '2001', 'has-int', 12345, '2009년 11월 16일');
    extra
      .prepare('INSERT INTO games (platform, external_id, name, release_date, release_date_text) VALUES (?, ?, ?, ?, ?)')
      .run('steam', '2002', 'null-text', null, null);
    extra.close();
    const before = dumpGames(dir) as { external_id: string; release_date_text: string | null }[];

    const handle = await migrateDatabase(dir, DRIZZLE);
    await handle.close();

    const expected = koEpochViaProduct(FILLED);
    const db = new Database(join(dir, 'questail.db'), { readonly: true });
    try {
      const rows = db
        .prepare('SELECT external_id, release_date, release_date_text FROM games ORDER BY external_id')
        .all() as { external_id: string; release_date: number | null; release_date_text: string | null }[];
      const byId = new Map(rows.map((row) => [row.external_id, row]));
      FILLED.forEach((text, index) => {
        const got = byId.get(String(1000 + index))?.release_date;
        expect(typeof expected.get(text), text).toBe('number');
        expect(got, text).toBe(expected.get(text));
      });
      expect(byId.get(String(1000 + FILLED.indexOf('2009년 2월 31일')))?.release_date).toBe(
        Date.UTC(2009, 2, 3) / 1000,
      );
      NOT_FILLED.forEach((text, index) => {
        expect(byId.get(String(1000 + FILLED.length + index))?.release_date, JSON.stringify(text)).toBeNull();
      });
      expect(byId.get('2001')?.release_date).toBe(12345);
      expect(byId.get('2002')?.release_date).toBeNull();
      // release_date_text 원문 변경 0
      expect(rows.map((row) => [row.external_id, row.release_date_text])).toEqual(
        before.map((row) => [row.external_id, row.release_date_text]),
      );
    } finally {
      db.close();
    }
  });

  it('같은 UPDATE SQL 재실행 전후 DB가 같고 두 번째 기동은 재적용·백업 0이다', async () => {
    const dir = tmpDir();
    await seedAt0004(dir, [...FILLED, ...NOT_FILLED]);
    let calls = 0;
    const first = await migrateDatabase(dir, DRIZZLE, async () => {
      calls += 1;
    });
    await first.close();
    expect(calls).toBe(1);
    const afterFirst = dumpGames(dir);
    const raw = new Database(join(dir, 'questail.db'));
    raw.exec(readFileSync(join(DRIZZLE, `${TAG_0005}.sql`), 'utf8'));
    raw.close();
    expect(dumpGames(dir)).toEqual(afterFirst);
    const second = await migrateDatabase(dir, DRIZZLE, async () => {
      calls += 1;
    });
    await second.close();
    expect(calls).toBe(1);
    expect(migrationCount(dir)).toBe(6);
    expect(dumpGames(dir)).toEqual(afterFirst);
  });

  it('백업 호출이 UPDATE보다 먼저다(호출 시점에 release_date 전부 NULL)', async () => {
    const dir = tmpDir();
    await seedAt0004(dir, ['2009년 11월 16일', '2009년 1월 9일']);
    const seen: (number | null)[] = [];
    const handle = await migrateDatabase(dir, DRIZZLE, async () => {
      const probe = new Database(join(dir, 'questail.db'), { readonly: true });
      try {
        for (const row of probe.prepare('SELECT release_date FROM games ORDER BY external_id').all() as {
          release_date: number | null;
        }[]) {
          seen.push(row.release_date);
        }
      } finally {
        probe.close();
      }
    });
    try {
      expect(seen).toEqual([null, null]);
      const after = handle.db.prepare('SELECT release_date FROM games ORDER BY external_id').all() as {
        release_date: number | null;
      }[];
      expect(after.every((row) => typeof row.release_date === 'number')).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it('백업 실패(주입)하면 release_date 변경 0·0005 적용 기록 0이다', async () => {
    const dir = tmpDir();
    await seedAt0004(dir, ['2009년 11월 16일']);
    const before = dumpGames(dir);
    await expect(
      migrateDatabase(dir, DRIZZLE, async () => {
        throw new Error('backup failed');
      }),
    ).rejects.toThrow('backup failed');
    expect(dumpGames(dir)).toEqual(before);
    expect(migrationCount(dir)).toBe(5);
  });

  it('SQL 파일은 정규식·UDF 없이 native 함수만 쓴다(REGEXP·load_extension 문자열 0)', () => {
    const sql = readFileSync(join(DRIZZLE, `${TAG_0005}.sql`), 'utf8');
    expect(sql).not.toMatch(/REGEXP|load_extension/i);
  });
});
