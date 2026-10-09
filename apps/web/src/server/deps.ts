/**
 * W3 제품 deps 조립 — A 실함수 + B 스텁(isConnected=false → Steam 호출 0).
 * apps/web/src/{db,data,jobs}/ 파일은 수정하지 않는다.
 * db 핸들은 boot가 shutdown에서 close한다. BootedServer에 db를 노출하지 않는다(D-05 후 결정).
 */
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { getConnection, normalizeSteamBaseUrl } from '../data/connection.js';
import type { SyncService } from '../data/service.js';
import { backupDatabase } from '../db/backup.js';
import { migrateDatabase } from '../db/migrate.js';
import { findRepoRoot, type BootDeps, type CronHandle } from './boot.js';
import { SNAPSHOT_CRON_EXPRESSION, scheduleCron } from './cron.js';
import { registerSnapshotCron, runOverdueSnapshot } from '../jobs/scheduler.js';

/** 실연결 판정 — getConnection(db).connected 매핑. db 없으면 false. */
export function isConnectedLive(args: {
  db: Database.Database | undefined;
}): boolean {
  if (args.db === undefined) {
    return false;
  }
  return getConnection(args.db).connected;
}

export function runOverdueSnapshotLive(args: {
  signal: AbortSignal;
  service: SyncService | undefined;
  db: Database.Database | undefined;
  timeZone: string;
}): Promise<void> {
  if (args.service === undefined || args.db === undefined) {
    return Promise.resolve();
  }
  const service = args.service;
  const db = args.db;
  return runOverdueSnapshot({
    db,
    now: Date.now,
    timeZone: args.timeZone,
    isConnected: () => isConnectedLive({ db }),
    service,
    signal: args.signal,
  }).then(() => undefined);
}

export function registerCronLive(
  args: {
    service: SyncService | undefined;
    db: Database.Database | undefined;
    timeZone: string;
  },
  scheduleCronFn: (
    expression: string,
    task: () => void,
    timezone?: string,
  ) => { stop: () => void | Promise<void> } = scheduleCron,
): CronHandle {
  if (args.service === undefined || args.db === undefined) {
    return { unregister: () => undefined };
  }
  const service = args.service;
  const db = args.db;
  const timeZone = args.timeZone;
  return registerSnapshotCron({
    db,
    now: Date.now,
    timeZone,
    isConnected: () => isConnectedLive({ db }),
    service,
    cronExpression: SNAPSHOT_CRON_EXPRESSION,
    scheduleCron: (expression, task) => scheduleCronFn(expression, task, timeZone),
  });
}

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

/**
 * W-store: 테스트 base가 있으면 baseUrl·storeBaseUrl·steamSpyBaseUrl 모두 같은 값,
 * 없으면 모두 미지정(공식 기본). 새 env 0.
 */
export function storeBasePair(baseUrl: string | undefined): {
  baseUrl?: string;
  storeBaseUrl?: string;
  steamSpyBaseUrl?: string;
} {
  if (baseUrl === undefined) {
    return {};
  }
  return { baseUrl, storeBaseUrl: baseUrl, steamSpyBaseUrl: baseUrl };
}

/** 제품 마이그레이션 폴더 — <루트>/apps/web/drizzle 절대 경로(cwd 무관). */
export function productMigrationsFolder(): string {
  return join(findRepoRoot(), 'apps', 'web', 'drizzle');
}

export function productionDeps(
  env: NodeJS.ProcessEnv = process.env,
  timeZone: string,
): BootDeps {
  return {
    env,
    timeZone,
    backupDatabase: (dataDir: string) => backupDatabase(dataDir),
    migrateDatabase: (dataDir: string, opts?: { backupBeforeApply?: () => Promise<void> }) =>
      migrateDatabase(dataDir, productMigrationsFolder(), opts?.backupBeforeApply),
    isConnected: (args) => isConnectedLive(args),
    runOverdueSnapshot: (args) => runOverdueSnapshotLive(args),
    registerCron: (args) => registerCronLive(args),
  };
}
