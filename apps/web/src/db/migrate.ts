import Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BootDatabase } from '../server/boot.js';
import { DB_FILE_NAME, openDatabase } from './open.js';

/** 제품 마이그레이션 폴더. drizzle-kit out과 같은 위치이다. */
export function defaultMigrationsFolder(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');
}

const BOOKKEEPING_DDL = `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at numeric
)`;

/**
 * DB 마이그레이션. 열고 순서대로 적용한다.
 * 백업은 적용할 마이그레이션이 있을 때만, BEGIN 전에 1회 한다.
 * pending 판정은 BOOKKEEPING_DDL 실행 전·DDL 없이(sqlite_master로
 * __drizzle_migrations 부재 = 전부 pending) 읽는다.
 * 첫 설치(DB 파일 없음)는 백업 호출 0으로 적용만 한다.
 * 백업이 throw하면 BEGIN 전 중단(쓰기 0)하고 핸들을 닫고 예외를 던진다.
 * 트랜잭션 경계(PM #67516 최종 승인): 원값 보관 → 트랜잭션 밖 OFF → 전체 실행 →
 * COMMIT 직전 foreign_key_check 위반 0 검사(위반 시 ROLLBACK·기동 중단) →
 * finally 원값 복원. 실패하면 핸들을 닫고 예외를 던진다.
 * 저널 판독 형식은 drizzle과 같다. 기록표 생성은 drizzle처럼 BEGIN 밖이다.
 * BootDatabase는 동기 close의 async 어댑터다(W3 경계).
 * db는 같은 open 핸들이다(PM #63860). 구조적 BootDeps 호환.
 */
export async function migrateDatabase(
  dataDir: string,
  migrationsFolder: string = defaultMigrationsFolder(),
  backupBeforeApply?: () => Promise<void>,
): Promise<BootDatabase & { db: Database.Database }> {
  const existedBefore = existsSync(join(dataDir, DB_FILE_NAME));
  const raw: Database.Database = openDatabase(dataDir);
  try {
    const pending = readPendingMigrations(raw, migrationsFolder);
    if (pending.length > 0 && existedBefore) {
      await backupBeforeApply?.();
    }
    applyMigrations(raw, pending);
  } catch (error) {
    raw.close();
    throw error;
  }
  return {
    close: async () => {
      raw.close();
    },
    db: raw,
  };
}

interface PendingMigration {
  sql: string[];
  hash: string;
  folderMillis: number;
}

/** pending 판독. DDL 없이 기록표 유무로만 본다. */
function readPendingMigrations(
  raw: Database.Database,
  migrationsFolder: string,
): PendingMigration[] {
  const migrations = readMigrationFiles({ migrationsFolder });
  const table = raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!table) return migrations;
  const last = raw
    .prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1')
    .get() as { created_at: number } | undefined;
  return migrations.filter(
    (migration) => last === undefined || Number(last.created_at) < migration.folderMillis,
  );
}

function applyMigrations(raw: Database.Database, pending: PendingMigration[]): void {
  raw.exec(BOOKKEEPING_DDL);
  const originalFk = raw.pragma('foreign_keys', { simple: true }) as unknown as number;
  raw.pragma('foreign_keys = OFF');
  try {
    raw.exec('BEGIN');
    try {
      for (const migration of pending) {
        for (const stmt of migration.sql) {
          raw.exec(stmt);
        }
      }
      const violations = raw.prepare('SELECT * FROM pragma_foreign_key_check').all();
      if (violations.length > 0) {
        throw new Error(
          `migration FK 위반 ${violations.length}건 — ROLLBACK 후 기동 중단`,
        );
      }
      for (const migration of pending) {
        raw
          .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
          .run(migration.hash, migration.folderMillis);
      }
      raw.exec('COMMIT');
    } catch (error) {
      try {
        raw.exec('ROLLBACK');
      } catch {
        /* 롤백 실패는 원본 예외를 유지한다 */
      }
      throw error;
    }
  } finally {
    raw.pragma(`foreign_keys = ${originalFk ? 'ON' : 'OFF'}`);
  }
}
