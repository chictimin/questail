/**
 * W3 제품 deps 조립 — A 실함수 + B 스텁(isConnected=false → Steam 호출 0).
 * apps/web/src/{db,data,jobs}/ 파일은 수정하지 않는다.
 * db 핸들은 boot가 shutdown에서 close한다. BootedServer에 db를 노출하지 않는다(D-05 후 결정).
 */
import { join } from 'node:path';
import { normalizeSteamBaseUrl } from '../data/connection.js';
import { backupDatabase } from '../db/backup.js';
import { migrateDatabase } from '../db/migrate.js';
import { findRepoRoot, type BootDeps } from './boot.js';

/** 테스트용 Steam API base 환경변수 (P-6). README에 노출하지 않는다. */
export const STEAM_API_BASE_ENV = 'QUESTAIL_STEAM_API_BASE';

/**
 * env base URL 해석 — 순수. 없으면 undefined(기존 동작),
 * 정상 루프백이면 정규화값, 거부면 값·키·경로 없는 안내와 함께 throw(기동 실패).
 */
export function resolveSteamApiBaseUrl(
  env: NodeJS.ProcessEnv,
): string | undefined {
  const raw = env[STEAM_API_BASE_ENV];
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const normalized = normalizeSteamBaseUrl(raw);
  if (normalized === null) {
    throw new Error(
      `[web] ${STEAM_API_BASE_ENV} 형태가 아니다 — http(s) URL(공식 기본 또는 루프백)만 허용한다. 값 없이 종료한다`,
    );
  }
  return normalized;
}

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
