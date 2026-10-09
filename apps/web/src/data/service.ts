import type Database from 'better-sqlite3';
import {
  finishSyncRun as finishSyncRunFn,
  getRunLocale as getRunLocaleFn,
  getSyncStatus as getSyncStatusFn,
  progressRun as progressRunFn,
  resyncSource as resyncSourceFn,
  startSync as startSyncFn,
  type FinishInput,
  type Locale,
  type ProgressPatch,
  type StartResult,
  type SyncStatusEntry,
} from './sync.js';
import type { CollectSource } from './syncRuns.js';
import type { FetchLike } from './connection.js';

/**
 * 동기 서비스 deps exact 형태 (v1.5.5).
 * keyPath·baseUrl·fetchFn·now·executor는 후속 수집기용 보관이다.
 * 현재 전이 함수는 wall clock을 쓰고 DB 핸들을 직접 쓴다.
 * executor 형태는 D06 경계에서 정의한다. 미구현 무동작을 명시한다.
 */
export interface SyncServiceDeps {
  db: Database.Database;
  keyPath: string;
  cacheDir: string;
  baseUrl?: string;
  fetchFn?: FetchLike;
  now?: () => number;
  executor?: unknown;
}

export interface SyncService {
  startSync: (opts: { sources?: CollectSource[]; locale: Locale }) => StartResult;
  resyncSource: (
    source: CollectSource,
    opts: { mode?: 'resume' | 'refresh'; locale: Locale },
  ) => StartResult;
  getSyncStatus: () => SyncStatusEntry[];
  progressRun: (runId: number, source: CollectSource, patch: ProgressPatch) => boolean;
  finishSyncRun: (runId: number, source: CollectSource, finish: FinishInput) => boolean;
  getRunLocale: (runId: number) => Locale | null;
}

/**
 * 동기 서비스 생성. 단일 instance가 프로세스 lock·generation을 단일
 * 소유한다. D06 executor·cron이 같은 instance를 공유한다. 암묵 env 0.
 * 락·세대 상태는 모듈 단일tons에 살아서 instance 간에 공유된다.
 */
export function createSyncService(deps: SyncServiceDeps): SyncService {
  // keyPath·cacheDir·baseUrl·fetchFn·now·executor는 후속 수집기용 보관이다.
  // 현재 전이 함수는 wall clock·직접 DB를 쓰고 이 값들을 쓰지 않는다.
  // 미구현 무동작을 명시한다.
  const { db } = deps;
  return {
    startSync: (opts) => startSyncFn(db, opts),
    resyncSource: (source, opts) => resyncSourceFn(db, source, opts),
    getSyncStatus: () => getSyncStatusFn(db),
    progressRun: (runId, source, patch) => progressRunFn(db, runId, source, patch),
    finishSyncRun: (runId, source, finish) => finishSyncRunFn(db, runId, source, finish),
    getRunLocale: (runId) => getRunLocaleFn(db, runId),
  };
}
