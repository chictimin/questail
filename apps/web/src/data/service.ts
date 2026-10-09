import type Database from 'better-sqlite3';
import {
  finishSyncRun as finishSyncRunFn,
  getRunLocale as getRunLocaleFn,
  getSyncStatus as getSyncStatusFn,
  progressRun as progressRunFn,
  resyncSource as resyncSourceFn,
  startSync as startSyncFn,
  ALL_SOURCES,
  type FinishInput,
  type Locale,
  type ProgressPatch,
  type StartResult,
  type SyncStatusEntry,
} from './sync.js';
import type { CollectSource } from './syncRuns.js';
import type { FetchLike } from './connection.js';
import type { JobExecutor } from '../jobs/collect.js';

/**
 * 동기 서비스 deps exact 형태 (v1.5.5).
 * keyPath·baseUrl·fetchFn·now·executor는 후속 수집기용 보관이다.
 * 현재 전이 함수는 wall clock을 쓰고 DB 핸들을 직접 쓴다.
 * executor 형태는 D06 경계에서 정의한다. 미구현 무동작을 명시한다.
 */
/** IANA 시간대(예 Asia/Seoul). observed_day·스냅샷 날짜의 zone 원천이다. */
export interface SyncServiceDeps {
  db: Database.Database;
  keyPath: string;
  cacheDir: string;
  baseUrl?: string;
  fetchFn?: FetchLike;
  now?: () => number;
  timeZone: string;
  executor?: (ctx: ExecutorDeps) => JobExecutor;
}

/** executor 생성 컨텍스트. 서비스 보관 deps를 넘긴다. */
export interface ExecutorDeps {
  transitions: {
    progressRun: SyncService['progressRun'];
    finishSyncRun: SyncService['finishSyncRun'];
    getSyncStatus: SyncService['getSyncStatus'];
  };
  db: Database.Database;
  keyPath: string;
  cacheDir: string;
  baseUrl?: string;
  fetchFn?: FetchLike;
  now?: () => number;
  timeZone: string;
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
  recover: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * 동기 서비스 생성. 단일 instance가 프로세스 lock·generation을 단일
 * 소유한다. D06 executor·cron이 같은 instance를 공유한다. 암묵 env 0.
 * 락·세대 상태는 모듈 싱글톤에 살아서 instance 간에 공유된다.
 */
export function createSyncService(deps: SyncServiceDeps): SyncService {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: deps.timeZone });
  } catch {
    throw new RangeError('timeZone은 IANA 시간대다(호출 계약 위반)');
  }
  const { db } = deps;
  let executor: JobExecutor | null = null;
  const executorOf = (): JobExecutor | null => {
    if (executor !== null) return executor;
    if (!deps.executor) return null;
    executor = deps.executor({
      transitions: {
        progressRun: (runId, source, patch) => progressRunFn(db, runId, source, patch),
        finishSyncRun: (runId, source, finish) => finishSyncRunFn(db, runId, source, finish),
        getSyncStatus: () => getSyncStatusFn(db),
      },
      db,
      keyPath: deps.keyPath,
      cacheDir: deps.cacheDir,
      baseUrl: deps.baseUrl,
      fetchFn: deps.fetchFn,
      now: deps.now,
      timeZone: deps.timeZone,
    });
    return executor;
  };
  const enqueueStarted = (
    targets: CollectSource[],
    mode: 'resume' | 'refresh',
    locale: Locale,
  ): void => {
    const exec = executorOf();
    if (!exec) return;
    const status = getSyncStatusFn(db);
    for (const source of targets) {
      const row = status.find((entry) => entry.source === source);
      if (row && row.runId !== null && row.state === 'running') {
        exec.enqueue({ runId: row.runId, source, generation: row.generation, mode, locale });
      }
    }
  };
  const service: SyncService = {
    startSync: (opts) => {
      const result = startSyncFn(db, { ...opts, timeZone: deps.timeZone });
      if (typeof result === 'number') {
        enqueueStarted(opts.sources ?? ALL_SOURCES, 'resume', opts.locale);
      }
      return result;
    },
    resyncSource: (source, opts) => {
      const result = resyncSourceFn(db, source, { ...opts, timeZone: deps.timeZone });
      if (typeof result === 'number') {
        enqueueStarted([source], opts.mode ?? 'resume', opts.locale);
      }
      return result;
    },
    getSyncStatus: () => getSyncStatusFn(db),
    progressRun: (runId, source, patch) => progressRunFn(db, runId, source, patch),
    finishSyncRun: (runId, source, finish) => finishSyncRunFn(db, runId, source, finish),
    getRunLocale: (runId) => getRunLocaleFn(db, runId),
    recover: async () => {
      await executorOf()?.recover();
    },
    stop: async () => {
      await executorOf()?.stop();
    },
  };
  return service;
}
