import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupDatabase } from '../../src/db/backup.js';
import { migrateDatabase } from '../../src/db/migrate.js';
import { openDatabase } from '../../src/db/open.js';

/**
 * D-02 DB 수명주기 테스트. 합성 v1 DB와 시험용 v1→v2 additive로
 * 열기·백업·마이그레이션·실패 중단을 확인한다. 제품 초기 SQL은 건드리지 않는다.
 * 보존 범위(PM #63954): 사용자 테이블 스키마+데이터. 기록표 새로 생기는
 * 초기 DB는 사용자 데이터 0 전제. 외부 DB 실험은 제품 이관 지원 아님.
 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'db');

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'questail-d02-'));
}

function seedV1(dir: string): void {
  const db = new Database(join(dir, 'questail.db'));
  try {
    db.exec(readFileSync(join(FIXTURES, 'v1.sql'), 'utf8'));
    db.prepare("INSERT INTO legacy_kv (key, value) VALUES ('k', 'v')").run();
    db.prepare(
      "INSERT INTO legacy_ratings (platform, external_id, score, updated_at, updated_by) VALUES ('steam', '990011', 8, 1, 'user'), ('steam', '990012', 5, 2, 'user')",
    ).run();
  } finally {
    db.close();
  }
}

/** 구 버전 사용 흉내: v1 마이그레이션만 적용한 뒤 한 행씩 쓴다 */
async function seedV1ByMigration(dir: string): Promise<void> {
  const handle = await migrateDatabase(dir, join(FIXTURES, 'migrations-v1'));
  try {
    const use = new Database(join(dir, 'questail.db'));
    try {
      use.prepare("INSERT INTO legacy_kv (key, value) VALUES ('k', 'v')").run();
      use.prepare(
        "INSERT INTO legacy_ratings (platform, external_id, score, updated_at, updated_by) VALUES ('steam', '990011', 8, 1, 'user'), ('steam', '990012', 5, 2, 'user')",
      ).run();
    } finally {
      use.close();
    }
  } finally {
    await handle.close();
  }
}

/** 별점 원천 행 전체. 행수·해시 관찰용(PM 조건, 대용 아님) */
function allLegacyRatings(dir: string): { external_id: string; score: number }[] {
  const db = new Database(join(dir, 'questail.db'), { readonly: true });
  try {
    return db
      .prepare('SELECT external_id, score FROM legacy_ratings ORDER BY external_id')
      .all() as { external_id: string; score: number }[];
  } finally {
    db.close();
  }
}

describe('db lifecycle', () => {
  it('열면 파일이 생기고 WAL 모드다', () => {
    const db = openDatabase(tmpDir());
    try {
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    } finally {
      db.close();
    }
  });

  it('백업하면 태그 파일이 생기고 내용이 같다', async () => {
    const dir = tmpDir();
    seedV1(dir);
    await backupDatabase(dir, new Date('2026-10-09T00:00:00Z'));
    const files = readdirSync(join(dir, 'backups'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^questail-.*\.db$/);
    const copy = new Database(join(dir, 'backups', files[0]), { readonly: true });
    try {
      expect(copy.prepare('SELECT value FROM legacy_kv WHERE key = ?').get('k')).toEqual({
        value: 'v',
      });
    } finally {
      copy.close();
    }
  });

  it('DB가 없으면 백업을 건너뛴다', async () => {
    const dir = tmpDir();
    await backupDatabase(dir);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('v1→v2 additive를 적용하고 기존 행을 보존한다', async () => {
    const dir = tmpDir();
    await seedV1ByMigration(dir);
    const handle = await migrateDatabase(dir, join(FIXTURES, 'migrations'));
    try {
      const check = new Database(join(dir, 'questail.db'), { readonly: true });
      try {
        expect(check.prepare('SELECT value FROM legacy_kv WHERE key = ?').get('k')).toEqual({
          value: 'v',
        });
        expect(
          check.prepare("SELECT name FROM sqlite_master WHERE name = 'legacy_extra'").get(),
        ).toBeTruthy();
      } finally {
        check.close();
      }
    } finally {
      await handle.close();
    }
  });

  it('마이그레이션 실패는 핸들을 닫고 예외를 던진다', async () => {
    const dir = tmpDir();
    seedV1(dir);
    await expect(migrateDatabase(dir, join(FIXTURES, 'missing'))).rejects.toThrow();
    const check = new Database(join(dir, 'questail.db'), { readonly: true });
    try {
      expect(check.prepare('SELECT value FROM legacy_kv WHERE key = ?').get('k')).toEqual({
        value: 'v',
      });
    } finally {
      check.close();
    }
  });

  it('중간 실패는 사용자 스키마·행을 되돌리고 빈 기록표만 남긴다', async () => {
    const dir = tmpDir();
    seedV1(dir);
    const snap = logicalSnapshot(dir);
    const masterBefore = fullMaster(dir);
    await expect(migrateDatabase(dir, join(FIXTURES, 'migrations-fail'))).rejects.toThrow();
    expect(logicalSnapshot(dir)).toEqual(snap);
    const masterAfter = fullMaster(dir);
    expect(masterAfter.filter((name) => !masterBefore.includes(name))).toEqual([
      '__drizzle_migrations',
    ]);
    const check = new Database(join(dir, 'questail.db'), { readonly: true });
    try {
      expect(
        check.prepare("SELECT name FROM sqlite_master WHERE name = 'fail_probe'").get(),
      ).toBeUndefined();
      expect(
        check
          .prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations")
          .get() as { n: number },
      ).toEqual({ n: 0 });
    } finally {
      check.close();
    }
  });

  it('기록표 있던 DB는 실패 전후 master 전체가 동일하다', async () => {
    const dir = tmpDir();
    await seedV1ByMigration(dir);
    const masterBefore = fullMasterWithSql(dir);
    const rowsBefore = allLegacyRows(dir);
    const ratingsBefore = allLegacyRatings(dir);
    expect(ratingsBefore).toHaveLength(2);
    await expect(migrateDatabase(dir, join(FIXTURES, 'migrations-fail'))).rejects.toThrow();
    expect(fullMasterWithSql(dir)).toEqual(masterBefore);
    expect(allLegacyRows(dir)).toEqual(rowsBefore);
    expect(allLegacyRatings(dir)).toEqual(ratingsBefore);
  });
});

/** 전체 master 이름+SQL. 기록표 포함 여부를 따로 본다 */
function fullMaster(dir: string): string[] {
  const db = new Database(join(dir, 'questail.db'), { readonly: true });
  try {
    return (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as { name: string }[]
    ).map((row) => row.name);
  } finally {
    db.close();
  }
}

/** master 전체(이름+SQL). 보존 범위 = 기록표 제외 동일(PM #63954) */
function fullMasterWithSql(dir: string): { name: string; sql: string | null }[] {
  const db = new Database(join(dir, 'questail.db'), { readonly: true });
  try {
    return db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string; sql: string | null }[];
  } finally {
    db.close();
  }
}

/** legacy 행 전체. 행수·값 해시 대용(PM #63954) */
function allLegacyRows(dir: string): { key: string; value: string | null }[] {
  const db = new Database(join(dir, 'questail.db'), { readonly: true });
  try {
    return db.prepare('SELECT key, value FROM legacy_kv ORDER BY key').all() as {
      key: string;
      value: string | null;
    }[];
  } finally {
    db.close();
  }
}

/** 논리 원천 해시. 기록표를 제외하므로 내용 변경 0을 덮지 않는다 — 기록표 차이는 fullMaster로 별도 보고 */
function logicalSnapshot(dir: string): string {
  const db = new Database(join(dir, 'questail.db'), { readonly: true });
  try {
    const schema = db
      .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY name")
      .all();
    const rows = db.prepare('SELECT key, value FROM legacy_kv ORDER BY key').all();
    const ratings = db
      .prepare('SELECT platform, external_id, score, updated_at, updated_by FROM legacy_ratings ORDER BY external_id')
      .all();
    return createHash('sha256').update(JSON.stringify({ schema, rows, ratings })).digest('hex');
  } finally {
    db.close();
  }
}
