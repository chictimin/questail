import type Database from 'better-sqlite3';
import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { AppMetaRateLimitedError, type SourceStatus } from '@questail/core';
import { syncGenerations, syncRuns } from '../db/schema.js';
import { startRun, toLocalDay, type CollectSource } from './syncRuns.js';

export type { CollectSource };

/** 전체 소스. C-3 5종 순서다. */
export const ALL_SOURCES: CollectSource[] = ['owned', 'wishlist', 'meta', 'achievements', 'steamspy'];

export type Locale = 'ko' | 'en';

export interface SyncIssue {
  code: string;
  params: Record<string, string | number>;
}

export interface SyncStatusEntry {
  source: CollectSource;
  state: SourceStatus;
  runId: number | null;
  generation: number;
  /** 소스 최근 finalized 시각. 없으면 null이다. */
  lastFinishedAt: number | null;
  /** 메타 부분 실패 수. NULL이면 미제공이다. */
  failedItems?: number;
  progress: { done: number; total: number | null; source: CollectSource };
  issue: SyncIssue | null;
}

export type StartResult = number | { code: 'SYNC_IN_PROGRESS'; source: CollectSource };

export interface FinishInput {
  status: 'ok' | 'failed' | 'held';
  finishedAt: number;
  itemCount: number | null;
  isFinalized: boolean;
  issue: SyncIssue | null;
  /** 메타 부분 실패 수. 없으면 미제공이다. */
  failedItems?: number;
}

export interface ProgressPatch {
  done?: number;
  total?: number | null;
}

interface SyncState {
  /** 프로세스 내 원자 락. 같은 틱에 검사·확보가 끝나므로 경합 없다. */
  running: Set<CollectSource>;
  /** 실행별 메타. D06 인계용으로 영속하지 않는다. 복구 채택분은 locale null이다. */
  meta: Map<number, { source: CollectSource; generation: number; locale: Locale | null }>;
  /** 실행별 진행. D06 영속과 별개다. */
  progress: Map<number, { done: number; total: number | null }>;
}

/**
 * DB별 격리. 같은 DB 서비스 공유 하나가 원자 gate를 유지하고, 다른 DB는
 * 별도 context를 쓴다. 제품은 single DB라 1개만 생긴다.
 */
const states = new WeakMap<Database.Database, SyncState>();
const stateRegistry = new Set<SyncState>();

function stateFor(db: Database.Database): SyncState {
  let state = states.get(db);
  if (!state) {
    state = { running: new Set(), meta: new Map(), progress: new Map() };
    states.set(db, state);
    stateRegistry.add(state);
  }
  return state;
}

function isLocale(value: unknown): value is Locale {
  return value === 'ko' || value === 'en';
}

function currentGeneration(db: Database.Database, source: CollectSource): number {
  const row = drizzle(db)
    .select({ generation: syncGenerations.generation })
    .from(syncGenerations)
    .where(eq(syncGenerations.source, source))
    .get();
  return row ? row.generation : 0;
}

function bumpGeneration(db: Database.Database, source: CollectSource): number {
  const orm = drizzle(db);
  const next = currentGeneration(db, source) + 1;
  const existing = orm
    .select({ source: syncGenerations.source })
    .from(syncGenerations)
    .where(eq(syncGenerations.source, source))
    .get();
  if (existing) {
    orm.update(syncGenerations).set({ generation: next }).where(eq(syncGenerations.source, source)).run();
  } else {
    orm.insert(syncGenerations).values({ source, generation: next }).run();
  }
  return next;
}

function parseIssue(code: string | null, params: string | null): SyncIssue | null {
  if (code === null) return null;
  try {
    const parsed: unknown = params === null ? {} : JSON.parse(params);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return { code, params: parsed as Record<string, string | number> };
    }
  } catch {
    /* 깨진 params는 빈 객체로 둔다 */
  }
  return { code, params: {} };
}

/**
 * D07 typed RATE_LIMITED → failed issue 연결.
 * AppMetaRateLimitedError를 받은 수집이 sync_runs 이슈로 기록할 값이다.
 */
export function rateLimitIssue(_error: AppMetaRateLimitedError): SyncIssue {
  return { code: 'RATE_LIMITED', params: {} };
}

/**
 * 전체·부분 수집 시작. 하나라도 running이면 아무 것도 시작하지 않고
 * 코드를 낸다(throw 아님). 성공하면 첫 실행 id를 낸다.
 */
export function startSync(
  db: Database.Database,
  opts: { sources?: CollectSource[]; locale: Locale; timeZone: string },
): StartResult {
  if (!isLocale(opts.locale)) {
    throw new RangeError('locale은 ko|en이다(호출 계약 위반)');
  }
  const state = stateFor(db);
  const targets = opts.sources ?? ALL_SOURCES;
  for (const source of targets) {
    if (state.running.has(source)) {
      return { code: 'SYNC_IN_PROGRESS', source };
    }
  }
  let firstId = 0;
  for (const source of targets) {
    state.running.add(source);
    const generation = bumpGeneration(db, source);
    const id = startRun(db, { source, startedAt: Math.floor(Date.now() / 1000), observedDay: toLocalDay(Date.now(), opts.timeZone), generation });
    state.meta.set(id, { source, generation, locale: opts.locale });
    state.progress.set(id, { done: 0, total: null });
    if (firstId === 0) firstId = id;
  }
  return firstId;
}

/**
 * 소스 단독 재수집. 해당 소스만 보고 다른 소스 실행은 허용한다.
 * mode 기본 resume. locale 필수.
 */
export function resyncSource(
  db: Database.Database,
  source: CollectSource,
  opts: { mode?: 'resume' | 'refresh'; locale: Locale; timeZone: string },
): StartResult {
  if (!isLocale(opts.locale)) {
    throw new RangeError('locale은 ko|en이다(호출 계약 위반)');
  }
  const state = stateFor(db);
  if (state.running.has(source)) {
    return { code: 'SYNC_IN_PROGRESS', source };
  }
  state.running.add(source);
  const generation = bumpGeneration(db, source);
  const id = startRun(db, { source, startedAt: Math.floor(Date.now() / 1000), observedDay: toLocalDay(Date.now(), opts.timeZone), generation });
  state.meta.set(id, { source, generation, locale: opts.locale });
  state.progress.set(id, { done: 0, total: null });
  return id;
}

/** 수락 판정. running 중이고 현 세대 실행일 때만 true다. */
function isAcceptedRun(db: Database.Database, runId: number, source: CollectSource): boolean {
  const state = stateFor(db);
  const meta = state.meta.get(runId);
  if (meta) {
    if (meta.source !== source) return false;
    if (!state.running.has(source)) return false;
    return meta.generation === currentGeneration(db, source);
  }
  return adoptCrashedRun(db, state, runId, source);
}

/**
 * 충돌 잔여 채택. 락은 없지만 DB 행이 running이면 복구 경로로 받아들이고
 * 락을 확보한다. 세대 불일치·종료분은 거부한다.
 */
function adoptCrashedRun(
  db: Database.Database,
  state: SyncState,
  runId: number,
  source: CollectSource,
): boolean {
  try {
    const row = drizzle(db)
      .select({ source: syncRuns.source, status: syncRuns.status, generation: syncRuns.generation })
      .from(syncRuns)
      .where(eq(syncRuns.id, runId))
      .get();
    if (!row || row.source !== source || row.status !== 'running') return false;
    if (row.generation !== currentGeneration(db, source)) return false;
    state.running.add(source);
    state.meta.set(runId, { source, generation: row.generation, locale: null });
    if (!state.progress.has(runId)) {
      state.progress.set(runId, { done: 0, total: null });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 진행 전이. 수락될 때만 true다. 구 세대·비실행은 거부한다.
 */
export function progressRun(
  db: Database.Database,
  runId: number,
  source: CollectSource,
  patch: ProgressPatch,
): boolean {
  const state = stateFor(db);
  if (!isAcceptedRun(db, runId, source)) return false;
  const prev = state.progress.get(runId) ?? { done: 0, total: null };
  state.progress.set(runId, {
    done: patch.done ?? prev.done,
    total: patch.total === undefined ? prev.total : patch.total,
  });
  return true;
}

/**
 * 종료 전이(완료·실패·보류). 같은 세대 첫 terminal만 확정하고 후속은
 * 멱등 무시한다. 구 세대·비실행도 무시한다. 적용 여부를 낸다.
 */
export function finishSyncRun(
  db: Database.Database,
  runId: number,
  source: CollectSource,
  finish: FinishInput,
): boolean {
  const state = stateFor(db);
  if (!isAcceptedRun(db, runId, source)) return false;
  const orm = drizzle(db);
  orm
    .update(syncRuns)
    .set({
      status: finish.status,
      finishedAt: finish.finishedAt,
      itemCount: finish.itemCount,
      isFinalized: finish.isFinalized ? 1 : 0,
      issueCode: finish.issue ? finish.issue.code : null,
      issueParams: finish.issue ? JSON.stringify(finish.issue.params) : null,
      failedItems: finish.failedItems ?? null,
    })
    .where(eq(syncRuns.id, runId))
    .run();
  state.running.delete(source);
  state.meta.delete(runId);
  state.progress.delete(runId);
  return true;
}

/** 실행별 locale 조회. D06 인계용. 없으면 null이다. */
export function getRunLocale(db: Database.Database, runId: number): Locale | null {
  return stateFor(db).meta.get(runId)?.locale ?? null;
}

/** 테스트·진단용 락 초기화. 제품 경로에서 쓰지 않는다. */
export function resetSyncLocksForTest(): void {
  for (const state of stateRegistry) {
    state.running.clear();
    state.meta.clear();
    state.progress.clear();
  }
}

/**
 * 소스별 상태. 실행 없으면 idle. progress는 큐 확정 전이라 done 0·total null이다.
 */
export function getSyncStatus(db: Database.Database): SyncStatusEntry[] {
  const orm = drizzle(db);
  return ALL_SOURCES.map((source) => {
    const row = orm
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.source, source))
      .orderBy(desc(syncRuns.id))
      .get();
    const finalized = orm
      .select({ finishedAt: syncRuns.finishedAt })
      .from(syncRuns)
      .where(and(eq(syncRuns.source, source), eq(syncRuns.isFinalized, 1)))
      .orderBy(desc(syncRuns.id))
      .get();
    const progress = stateFor(db).progress.get(row ? row.id : -1) ?? { done: 0, total: null };
    return {
      source,
      state: (row ? row.status : 'idle') as SourceStatus,
      runId: row ? row.id : null,
      generation: currentGeneration(db, source),
      lastFinishedAt: finalized ? finalized.finishedAt : null,
      ...(row?.failedItems != null ? { failedItems: row.failedItems } : {}),
      progress: { done: progress.done, total: progress.total, source },
      issue: row ? parseIssue(row.issueCode, row.issueParams) : null,
    };
  });
}
