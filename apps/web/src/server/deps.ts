/**
 * W3 제품 deps 조립 — A 실함수 + B 스텁(isConnected=false → Steam 호출 0).
 * apps/web/src/{db,data,jobs}/ 파일은 수정하지 않는다.
 * db 핸들은 boot가 shutdown에서 close한다. BootedServer에 db를 노출하지 않는다(D-05 후 결정).
 */
import { join } from 'node:path';
import { backupDatabase } from '../db/backup.js';
import { migrateDatabase } from '../db/migrate.js';
import { findRepoRoot, type BootDeps } from './boot.js';

/** 제품 마이그레이션 폴더 — <루트>/apps/web/drizzle 절대 경로(cwd 무관). */
export function productMigrationsFolder(): string {
  return join(findRepoRoot(), 'apps', 'web', 'drizzle');
}

export function productionDeps(env: NodeJS.ProcessEnv = process.env): BootDeps {
  return {
    env,
    backupDatabase: (dataDir: string) => backupDatabase(dataDir),
    migrateDatabase: (dataDir: string) =>
      migrateDatabase(dataDir, productMigrationsFolder()),
    recoverInterruptedJobs: async () => undefined,
    isConnected: () => false,
    runOverdueSnapshot: async () => undefined,
    registerCron: () => ({ unregister: () => undefined }),
  };
}
