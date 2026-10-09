import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupDatabase } from '../../src/db/backup.js';
import { migrateDatabase } from '../../src/db/migrate.js';
import { openDatabase } from '../../src/db/open.js';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';

/** 기록표 행수. 호환 0건 판정용 */
function migrationRecordCount(dir: string): number {
  const db = new Database(join(dir, 'questail.db'), { readonly: true });
  try {
    return (db.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as { n: number }).n;
  } finally {
    db.close();
  }
}

/**
 * D-02 DB 수명주기 테스트. 합성 v1 DB와 시험용 v1→v2 additive로
 * 열기·백업·마이그레이션·실패 중단을 확인한다. 제품 초기 SQL은 건드리지 않는다.
 * 보존 범위(PM #63954): 사용자 테이블 스키마+데이터. 기록표 새로 생기는
 * 초기 DB는 사용자 데이터 0 전제. 외부 DB 실험은 제품 이관 지원 아님.
 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'db');

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'questail-nozi-d08-'));
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

  it('FK 위반 마이그레이션은 COMMIT 전 검사에서 되돌린다', async () => {
    const dir = tmpDir();
    await expect(migrateDatabase(dir, join(FIXTURES, 'migrations-fkbad'))).rejects.toThrow();
    const check = new Database(join(dir, 'questail.db'), { readonly: true });
    try {
      expect(
        check.prepare("SELECT name FROM sqlite_master WHERE name IN ('fk_parent', 'fk_child')").all(),
      ).toEqual([]);
    } finally {
      check.close();
    }
  });
  it('drizzle 적용분은 자체 실행기가 0건 재적용한다', async () => {
    const dir = tmpDir();
    const first = new Database(join(dir, 'questail.db'));
    try {
      drizzleMigrate(drizzle(first), { migrationsFolder: join(FIXTURES, 'migrations-v1') });
    } finally {
      first.close();
    }
    const before = migrationRecordCount(dir);
    const handle = await migrateDatabase(dir, join(FIXTURES, 'migrations-v1'));
    try {
      expect(migrationRecordCount(dir)).toBe(before);
    } finally {
      await handle.close();
    }
  });

  it('자체 적용분은 drizzle이 0건 재적용한다', async () => {
    const dir = tmpDir();
    const handle = await migrateDatabase(dir, join(FIXTURES, 'migrations-v1'));
    try {
      const before = migrationRecordCount(dir);
      const raw = new Database(join(dir, 'questail.db'));
      try {
        drizzleMigrate(drizzle(raw), { migrationsFolder: join(FIXTURES, 'migrations-v1') });
      } finally {
        raw.close();
      }
      expect(migrationRecordCount(dir)).toBe(before);
    } finally {
      await handle.close();
    }
  });

  it('0002는 기존 sync_runs 행을 보존한다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-d08-'));
    const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const initial = readdirSync(join(webDir, 'drizzle')).find((name) =>
      name.startsWith('0000_'),
    ) as string;
    const upgrade = readdirSync(join(webDir, 'drizzle')).find((name) =>
      name.startsWith('0002_'),
    ) as string;
    const db = new Database(join(dir, 'questail.db'));
    try {
      db.exec(readFileSync(join(webDir, 'drizzle', initial), 'utf8'));
      db.prepare(
        "INSERT INTO sync_runs (source, status, started_at, observed_day, is_finalized) VALUES ('owned', 'ok', 1700000000, '2026-10-09', 1)",
      ).run();
      db.prepare(
        "INSERT INTO sync_runs (source, status, started_at, observed_day, is_finalized) VALUES ('owned', 'ok', 1700000001, '2026-10-09', 1)",
      ).run();
      db.prepare(
        "INSERT INTO sync_runs (source, status, started_at, observed_day, is_finalized) VALUES ('meta', 'ok', 1700000000, '2026-10-09', 1)",
      ).run();
    } finally {
      db.close();
    }
    const folder = join(dir, 'upgrade');
    mkdirSync(join(folder, 'meta'), { recursive: true });
    copyFileSync(join(webDir, 'drizzle', upgrade), join(folder, upgrade));
    writeFileSync(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [{ idx: 0, version: '6', when: 1728000000003, tag: upgrade.replace(/\.sql$/, ''), breakpoints: true }],
      }),
    );
    const handle = await migrateDatabase(dir, folder);
    try {
      const check = new Database(join(dir, 'questail.db'), { readonly: true });
      try {
        const rows = check
          .prepare('SELECT id, source, started_at, generation FROM sync_runs ORDER BY id')
          .all() as { id: number; source: string; started_at: number; generation: number }[];
        expect(rows.map((row) => row.id)).toEqual([1, 2, 3]);
        expect(rows.map((row) => row.started_at)).toEqual([1700000000, 1700000001, 1700000000]);
        expect(rows.map((row) => row.generation)).toEqual([1, 2, 1]);
        expect(() =>
          check
            .prepare(
              "INSERT INTO sync_runs (source, status, started_at, observed_day, is_finalized, generation) VALUES ('owned', 'ok', 1, '2026-10-09', 1, 1)",
            )
            .run(),
        ).toThrow();
        expect(check.prepare('SELECT * FROM pragma_foreign_key_check').all()).toEqual([]);
      } finally {
        check.close();
      }
    } finally {
      await handle.close();
    }
  });

  it('pending 있으면 백업 후 적용한다(KEEP-1: v1→v2 백업 ≥1)', async () => {
    const dir = tmpDir();
    await seedV1ByMigration(dir);
    let calls = 0;
    const handle = await migrateDatabase(dir, join(FIXTURES, 'migrations'), async () => {
      calls += 1;
      await backupDatabase(dir, new Date('2026-10-09T00:00:00Z'));
    });
    try {
      expect(calls).toBe(1);
      const files = readdirSync(join(dir, 'backups'));
      expect(files.length).toBeGreaterThanOrEqual(1);
      const check = new Database(join(dir, 'questail.db'), { readonly: true });
      try {
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

  it('pending 없으면 백업 호출 0이다', async () => {
    const dir = tmpDir();
    await seedV1ByMigration(dir);
    const first = await migrateDatabase(dir, join(FIXTURES, 'migrations-v1'));
    await first.close();
    let calls = 0;
    const second = await migrateDatabase(dir, join(FIXTURES, 'migrations-v1'), async () => {
      calls += 1;
    });
    try {
      expect(calls).toBe(0);
      expect(existsSync(join(dir, 'backups'))).toBe(false);
    } finally {
      await second.close();
    }
  });

  it('백업 실패하면 BEGIN 전 중단하고 원본을 그대로 둔다', async () => {
    const dir = tmpDir();
    seedV1(dir);
    const snap = logicalSnapshot(dir);
    await expect(
      migrateDatabase(dir, join(FIXTURES, 'migrations'), async () => {
        throw new Error('backup failed');
      }),
    ).rejects.toThrow('backup failed');
    expect(logicalSnapshot(dir)).toEqual(snap);
    const check = new Database(join(dir, 'questail.db'), { readonly: true });
    try {
      expect(
        check.prepare("SELECT name FROM sqlite_master WHERE name = '__drizzle_migrations'").get(),
      ).toBeUndefined();
    } finally {
      check.close();
    }
  });

  it('첫 설치(DB 파일 없음)는 백업 호출 0으로 적용만 한다', async () => {
    const dir = tmpDir();
    let calls = 0;
    const handle = await migrateDatabase(dir, join(FIXTURES, 'migrations-v1'), async () => {
      calls += 1;
    });
    try {
      expect(calls).toBe(0);
      expect(migrationRecordCount(dir)).toBeGreaterThan(0);
      expect(existsSync(join(dir, 'backups'))).toBe(false);
    } finally {
      await handle.close();
    }
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
