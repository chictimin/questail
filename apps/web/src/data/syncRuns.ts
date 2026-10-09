import type Database from 'better-sqlite3';
import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { syncRuns } from '../db/schema.js';

/** 수집 실행 기록. */
export type CollectSource = 'owned' | 'wishlist' | 'meta' | 'achievements' | 'steamspy';

/** epoch ms → IANA 시간대 로컬 날짜 YYYY-MM-DD. scheduler·수집이 공유한다. */
export function toLocalDay(nowMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(nowMs));
}

export interface StartRunInput {
  source: CollectSource;
  startedAt: number;
  observedDay: string;
  generation: number;
}

export interface FinishRunInput {
  status: 'running' | 'ok' | 'failed' | 'held';
  finishedAt: number;
  itemCount: number | null;
  isFinalized: boolean;
  issueCode: string | null;
  issueParams: string | null;
}

/** 실행 시작. 같은 소스·시작시각 중복은 거부된다. */
export function startRun(db: Database.Database, input: StartRunInput): number {
  const [row] = drizzle(db)
    .insert(syncRuns)
    .values({
      source: input.source,
      status: 'running',
      startedAt: input.startedAt,
      finishedAt: null,
      itemCount: null,
      observedDay: input.observedDay,
      isFinalized: 0,
      issueCode: null,
      issueParams: null,
      generation: input.generation,
      failedItems: null,
    })
    .returning({ id: syncRuns.id })
    .all();
  return row.id;
}

/** 실행 종료. 차분 확정 여부와 이슈를 기록한다. */
export function finishRun(db: Database.Database, id: number, input: FinishRunInput): void {
  drizzle(db)
    .update(syncRuns)
    .set({
      status: input.status,
      finishedAt: input.finishedAt,
      itemCount: input.itemCount,
      isFinalized: input.isFinalized ? 1 : 0,
      issueCode: input.issueCode,
      issueParams: input.issueParams,
    })
    .where(eq(syncRuns.id, id))
    .run();
}

/** 최신 확정 실행. 없으면 null이다. */
export function latestFinalizedRun(
  db: Database.Database,
  source: CollectSource,
): { id: number; observedDay: string } | null {
  const row = drizzle(db)
    .select({ id: syncRuns.id, observedDay: syncRuns.observedDay })
    .from(syncRuns)
    .where(eq(syncRuns.source, source))
    .orderBy(desc(syncRuns.id))
    .get();
  return row ?? null;
}
