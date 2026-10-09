import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BootDatabase } from '../server/boot.js';
import { openDatabase } from './open.js';

/** 제품 마이그레이션 폴더. drizzle-kit out과 같은 위치이다. */
export function defaultMigrationsFolder(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');
}

/**
 * DB 마이그레이션. 열고 순서대로 적용한다.
 * 실패 시 핸들을 닫고 예외를 그대로 던진다 — 기동이 중단된다.
 * 원본보존 근거(drizzle-orm 0.45.3 실소스): migrate()는 BEGIN 후 전체
 * 저널을 실행하고 COMMIT, 실패 시 ROLLBACK한다. 사용자 스키마·행 변경은
 * 0건이고 기록표 삽입도 함께 롤백된다. 단, BEGIN 전 bookkeeping
 * CREATE TABLE IF NOT EXISTS __drizzle_migrations는 롤백 대상 밖이라
 * 초기 DB에는 빈 기록표가 남는다. 직전 백업 파일은 복원 수단으로 별도 보존.
 * BootDatabase는 동기 close의 async 어댑터다(W3 경계).
 * db는 같은 open 핸들이다(PM #63860). 구조적 BootDeps 호환.
 */
export async function migrateDatabase(
  dataDir: string,
  migrationsFolder: string = defaultMigrationsFolder(),
): Promise<BootDatabase & { db: Database.Database }> {
  const raw: Database.Database = openDatabase(dataDir);
  try {
    await migrate(drizzle(raw), { migrationsFolder });
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
