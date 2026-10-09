import Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BootDatabase } from '../server/boot.js';
import { openDatabase } from './open.js';

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
): Promise<BootDatabase & { db: Database.Database }> {
  const raw: Database.Database = openDatabase(dataDir);
  try {
    applyMigrations(raw, migrationsFolder);
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

function applyMigrations(raw: Database.Database, migrationsFolder: string): void {
  const migrations = readMigrationFiles({ migrationsFolder });
  raw.exec(BOOKKEEPING_DDL);
  const last = raw
    .prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1')
    .get() as { created_at: number } | undefined;
  const pending = migrations.filter(
    (migration) => last === undefined || Number(last.created_at) < migration.folderMillis,
  );
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
