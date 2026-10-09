import type Database from 'better-sqlite3';
import type { Locale, StartResult } from '../data/sync.js';
import type { CollectSource } from '../data/syncRuns.js';
import type { CronHandle } from '../server/boot.js';

/** overdue 판정·cron 등록 주입점. wall clock·env를 직접 읽지 않는다. */
export interface SnapshotSchedulerDeps {
  db: Database.Database;
  /** epoch ms. */
  now: () => number;
  /** 로컬 날짜 판정용 IANA 시간대. */
  timeZone: string;
  isConnected: () => boolean | Promise<boolean>;
  /** resyncSource만 쓴다. */
  service: {
    resyncSource: (
      source: CollectSource,
      opts: { mode?: 'resume' | 'refresh'; locale: Locale },
    ) => StartResult;
  };
  signal?: AbortSignal;
}

export interface SnapshotCronDeps extends SnapshotSchedulerDeps {
  cronExpression: string;
  scheduleCron: (expression: string, task: () => void) => {
    stop: () => void | Promise<void>;
  };
}

export type OverdueReason =
  | 'triggered'
  | 'already-done'
  | 'no-locale'
  | 'disconnected'
  | 'in-progress'
  | 'aborted';

function localDay(nowMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(nowMs));
}

function readPreference(db: Database.Database, key: string): string | null {
  const row = db
    .prepare('SELECT value AS v FROM preferences WHERE key = ?')
    .get(key) as { v: string } | undefined;
  return row?.v ?? null;
}

function asLocale(value: string | null): Locale | null {
  return value === 'ko' || value === 'en' ? value : null;
}

/**
 * 밀린 스냅샷 1회 (D-09). 오늘(로컬) owned 성공 run이 없으면 owned만
 * resyncSource(mode resume)로 트리거한다. startSync는 부르지 않는다(N-2).
 * locale은 last_collect_locale → preferences locale 순, 없으면 skip한다.
 * SYNC_IN_PROGRESS면 건너뛰고 재시도하지 않는다.
 */
export async function runOverdueSnapshot(
  deps: SnapshotSchedulerDeps,
): Promise<{ triggered: boolean; reason: OverdueReason }> {
  if (deps.signal?.aborted) return { triggered: false, reason: 'aborted' };
  if (!(await deps.isConnected())) return { triggered: false, reason: 'disconnected' };
  const today = localDay(deps.now(), deps.timeZone);
  const done = deps.db
    .prepare(
      "SELECT 1 FROM sync_runs WHERE source = 'owned' AND status = 'ok' AND observed_day = ? LIMIT 1",
    )
    .get(today);
  if (done) return { triggered: false, reason: 'already-done' };
  const locale =
    asLocale(readPreference(deps.db, 'last_collect_locale')) ??
    asLocale(readPreference(deps.db, 'locale'));
  if (!locale) return { triggered: false, reason: 'no-locale' };
  const started = deps.service.resyncSource('owned', { mode: 'resume', locale });
  if (typeof started !== 'number') return { triggered: false, reason: 'in-progress' };
  return { triggered: true, reason: 'triggered' };
}

/** 일일 cron 등록. tick 실패는 삼킨다(로거 주입 없음, 관측 범위 밖). */
export function registerSnapshotCron(deps: SnapshotCronDeps): CronHandle {
  const task = deps.scheduleCron(deps.cronExpression, () => {
    void runOverdueSnapshot(deps).catch(() => undefined);
  });
  return {
    unregister: () => {
      void task.stop();
    },
  };
}
