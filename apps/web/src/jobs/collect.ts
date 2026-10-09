import type Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { dirname, join } from 'node:path';
import {
  buildOwnedGamesPath,
  buildPlayerAchievementsPath,
  buildWishlistPath,
  createSteamSpyLimiter,
  fetchAppMetaStatus,
  fetchSteamSpyUserTags,
  judgeAchievementsResponse,
  judgeOwnedResponse,
  judgeWishlistResponse,
  normalizeOwnedGames,
  normalizePlayerAchievements,
  STEAMSPY_CACHE_DIR_NAME,
  type IssueParams,
  type SteamSpyClock,
  type SteamSpyLimiter,
  type SyncErrorCode,
} from '@questail/core';
import { ownershipSpans, syncRuns, wishlistSpans, checkpoints } from '../db/schema.js';
import { applyOwnedDiff } from '../data/ownership.js';
import { applyWishlistDiff } from '../data/wishlist.js';
import { recordPlaytimeSnapshot } from '../data/playtime.js';
import { saveCollectedAchievements, toCollectedAchievements } from '../data/achievements.js';
import { saveCollectedTags } from '../data/tags.js';
import { getAchievementSettings } from '../data/viewState.js';
import { createSteamRequest, getConnection, type FetchLike } from '../data/connection.js';
import type { CollectSource, Locale } from '../data/sync.js';
import { toLocalDay } from '../data/syncRuns.js';
import {
  buildQueue,
  itemKey,
  readLastCollectLocale,
  writeCheckpoint,
  writeLastCollectLocale,
} from './queue.js';

/** 수집 잡. */
export interface CollectJob {
  runId: number;
  source: CollectSource;
  generation: number;
  mode: 'resume' | 'refresh';
  locale: Locale | null;
}

/** D08 전이 묶음. 순환 의존 없이 인자로 받는다. */
export interface CollectTransitions {
  progressRun: (runId: number, source: CollectSource, patch: { done?: number; total?: number | null }) => boolean;
  finishSyncRun: (
    runId: number,
    source: CollectSource,
    finish: {
      status: 'ok' | 'failed' | 'held';
      finishedAt: number;
      itemCount: number | null;
      isFinalized: boolean;
      issue: { code: string; params: Record<string, string | number> } | null;
      failedItems?: number;
    },
  ) => boolean;
  getSyncStatus: () => { source: CollectSource; runId: number | null; generation: number }[];
}

export interface ExecutorContext {
  transitions: CollectTransitions;
  db: Database.Database;
  keyPath: string;
  cacheDir: string;
  baseUrl?: string;
  fetchFn?: FetchLike;
  now?: () => number;
  timeZone: string;
  storeBaseUrl?: string;
  steamSpyBaseUrl?: string;
}

export interface JobExecutor {
  enqueue: (job: CollectJob) => void;
  recover: () => Promise<void>;
  stop: () => Promise<void>;
}

const STOP_TIMEOUT_MS = 10_000;

/**
 * 테스트 전용 steamspy clock·limiter 주입. 제품 옵션 아님(D-07 intervalMs 선례).
 * executor 생성 뒤 호출하면 그 executor의 수집에 쓴다. null이면 기본으로 복귀.
 */
export interface SteamSpyTestHooks {
  clock?: SteamSpyClock;
  limiter?: SteamSpyLimiter;
}

let steamSpyTestHooks: SteamSpyTestHooks | null = null;

export function setSteamSpyTestHooksForTest(hooks: SteamSpyTestHooks | null): void {
  steamSpyTestHooks = hooks;
}

function countOpen(
  db: Database.Database,
  table: typeof ownershipSpans | typeof wishlistSpans,
): number {
  return (
    drizzle(db).select({ id: table.id }).from(table).where(eq(table.ended, 0)).all()
  ).length;
}

/** 중단 경합. 원본 promise는 race가 구독하므로 미처리 거부가 남지 않는다. */
function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('수집 중단', 'AbortError'));
  }
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          reject(new DOMException('수집 중단', 'AbortError'));
        },
        { once: true },
      );
    }),
  ]);
}

/**
 * 수집 executor 생성. data가 export하고 웹 run.ts는 조립만 한다.
 * 큐는 순차 FIFO로 처리한다. stop()은 throw 0으로 정착한다.
 */
export function createJobExecutor(ctx: ExecutorContext): JobExecutor {
  const queue: CollectJob[] = [];
  let pumping = false;
  let stopped = false;
  const inFlight = new Set<Promise<void>>();
  const controllers = new Set<AbortController>();

  const now = ctx.now ?? Date.now;
  const spyLimiter = createSteamSpyLimiter();

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length > 0 && !stopped) {
        const job = queue.shift() as CollectJob;
        const task = runJob(job)
          .catch(() => {
            /* 저장 실패 등은 running 유지·recover 대상, finish 호출 0(#82481).
               여기서 잡지 않으면 void pump()에서 unhandled rejection이 된다. */
          })
          .finally(() => {
            inFlight.delete(task);
          });
        inFlight.add(task);
        await task;
      }
    } finally {
      pumping = false;
    }
  }

  function trackController(): { signal: AbortSignal; release: () => void } {
    const ctrl = new AbortController();
    controllers.add(ctrl);
    return { signal: ctrl.signal, release: () => controllers.delete(ctrl) };
  }

  /** FetchLike. 주입 없으면 tracked signal로 실fetch한다. */
  function authedFetch(signal: AbortSignal): FetchLike {
    if (ctx.fetchFn) {
      const injected = ctx.fetchFn;
      return (url) => raceWithSignal(injected(url), signal);
    }
    return (url) => fetch(url, { signal });
  }

  function finishFailed(
    job: CollectJob,
    code: SyncErrorCode,
    params: IssueParams,
  ): void {
    ctx.transitions.finishSyncRun(job.runId, job.source, {
      status: 'failed',
      finishedAt: Math.floor(now() / 1000),
      itemCount: 0,
      isFinalized: true,
      issue: { code, params },
    });
  }

  async function runJob(job: CollectJob): Promise<void> {
    if (job.locale !== null) {
      writeLastCollectLocale(ctx.db, job.locale);
    }
    switch (job.source) {
      case 'owned':
        await runOwned(job);
        break;
      case 'wishlist':
        await runWishlist(job);
        break;
      case 'meta':
        await runMeta(job);
        break;
      case 'achievements':
        await runAchievements(job);
        break;
      case 'steamspy':
        await runSteamspy(job);
        break;
    }
  }

  async function runOwned(job: CollectJob): Promise<void> {
    const at = now();
    const prevCount = countOpen(ctx.db, ownershipSpans);
    const connection = getConnection(ctx.db);
    if (!connection.connected || connection.steamId === null) {
      finishFailed(job, 'KEY_STORE_FAILED', {});
      holdDependents(job);
      return;
    }
    const steamId = connection.steamId;
    const { signal, release } = trackController();
    try {
      const authed = createSteamRequest({
        keyPath: ctx.keyPath,
        baseUrl: ctx.baseUrl,
        fetchFn: authedFetch(signal),
      });
      let payload: unknown;
      try {
        const result = await raceWithSignal(
          authed.request((key, base) => buildOwnedGamesPath(key, steamId, base)),
          signal,
        );
        if (!result.ok) {
          finishFailed(job, result.code, result.params);
          holdDependents(job);
          return;
        }
        payload = result.body;
      } catch (error) {
        if (signal.aborted) return; // stop — running 유지, recover가 잇는다
        if (error instanceof DOMException && error.name === 'AbortError') return;
        finishFailed(job, 'PAYLOAD_CORRUPT', {});
        holdDependents(job);
        return;
      }
      const verdict = judgeOwnedResponse(payload, prevCount);
      if (verdict.kind !== 'ok') {
        ctx.transitions.finishSyncRun(job.runId, job.source, {
          status: verdict.kind === 'held' ? 'held' : 'failed',
          finishedAt: Math.floor(now() / 1000),
          itemCount: 0,
          isFinalized: true,
          issue: { code: verdict.code, params: verdict.params },
        });
        if (verdict.kind === 'failed') {
          holdDependents(job);
        }
        return;
      }
      const gamesList = normalizeOwnedGames(payload);
      let heldTimeZero = false;
      const apply = ctx.db.transaction(() => {
        const applied = applyOwnedDiff(ctx.db, {
          verdict,
          games: gamesList.map((game) => ({ ...game, name: undefined })),
          clock: { observedAt: Math.floor(at / 1000), observedDay: toLocalDay(at, ctx.timeZone), timezone: ctx.timeZone },
          syncRunId: job.runId,
          isFirstCollection: countOpen(ctx.db, ownershipSpans) === 0,
        });
        if (applied.outcome === 'held-time-zero') {
          heldTimeZero = true;
          return;
        }
        for (const game of gamesList) {
          recordPlaytimeSnapshot(
            ctx.db,
            { platform: 'steam', externalId: String(game.appid) },
            {
              observedAt: Math.floor(at / 1000),
              observedDay: toLocalDay(at, ctx.timeZone),
              timezone: ctx.timeZone,
              totalMinutes: game.playtimeForever,
              lastPlayed: game.lastPlayed,
              playtime2Weeks: game.playtime2weeks,
              syncRunId: job.runId,
            },
          );
        }
      });
      apply();
      if (heldTimeZero) {
        ctx.transitions.finishSyncRun(job.runId, job.source, {
          status: 'held',
          finishedAt: Math.floor(now() / 1000),
          itemCount: gamesList.length,
          isFinalized: true,
          issue: { code: 'HELD_TIME_ZERO', params: {} },
        });
        return;
      }
      ctx.transitions.finishSyncRun(job.runId, job.source, {
        status: 'ok',
        finishedAt: Math.floor(now() / 1000),
        itemCount: gamesList.length,
        isFinalized: true,
        issue: null,
      });
    } finally {
      release();
    }
  }

  /** 보유 실패 시 종속 소스 실행을 held로 끝낸다. */
  function holdDependents(job: CollectJob): void {
    for (const queued of [...queue]) {
      if (queued.runId === job.runId || queued.source === 'owned' || queued.source === 'wishlist') {
        continue;
      }
      queue.splice(queue.indexOf(queued), 1);
      ctx.transitions.finishSyncRun(queued.runId, queued.source, {
        status: 'held',
        finishedAt: Math.floor(now() / 1000),
        itemCount: 0,
        isFinalized: true,
        issue: { code: 'HELD_DEPENDENCY', params: { source: job.source } },
      });
    }
  }

  async function runWishlist(job: CollectJob): Promise<void> {
    const at = now();
    const connection = getConnection(ctx.db);
    if (!connection.connected || connection.steamId === null) {
      finishFailed(job, 'KEY_STORE_FAILED', {});
      return;
    }
    const steamId = connection.steamId;
    const { signal, release } = trackController();
    try {
      const authed = createSteamRequest({
        keyPath: ctx.keyPath,
        baseUrl: ctx.baseUrl,
        fetchFn: authedFetch(signal),
      });
      let payload: unknown;
      try {
        const result = await raceWithSignal(
          authed.request((key, base) => buildWishlistPath(key, steamId, base)),
          signal,
        );
        if (!result.ok) {
          finishFailed(job, result.code, result.params);
          return;
        }
        payload = result.body;
      } catch (error) {
        if (signal.aborted) return; // stop — running 유지, recover가 잇는다
        if (error instanceof DOMException && error.name === 'AbortError') return;
        finishFailed(job, 'PAYLOAD_CORRUPT', {});
        return;
      }
      const verdict = judgeWishlistResponse(payload);
      if (verdict.kind !== 'ok') {
        finishFailed(job, verdict.code, verdict.params);
        return;
      }
      applyWishlistDiff(ctx.db, {
        verdict,
        names: {},
        observedAt: Math.floor(at / 1000),
        syncRunId: job.runId,
      });
      ctx.transitions.finishSyncRun(job.runId, job.source, {
        status: 'ok',
        finishedAt: Math.floor(now() / 1000),
        itemCount: verdict.items.length,
        isFinalized: true,
        issue: null,
      });
    } finally {
      release();
    }
  }

  async function runAchievements(job: CollectJob): Promise<void> {
    // OFF 확정(PM #83058): 요청 0·finish ok·itemCount null·issue null. 행 무변경.
    if (!getAchievementSettings(ctx.db).enabled) {
      ctx.transitions.finishSyncRun(job.runId, job.source, {
        status: 'ok',
        finishedAt: Math.floor(now() / 1000),
        itemCount: null,
        isFinalized: true,
        issue: null,
      });
      return;
    }
    const connection = getConnection(ctx.db);
    if (!connection.connected || connection.steamId === null) {
      finishFailed(job, 'KEY_STORE_FAILED', {});
      return;
    }
    const steamId = connection.steamId;
    const targets = buildQueue(ctx.db, { source: job.source, generation: job.generation, mode: job.mode }).map(
      (key) => key.split(':')[1],
    );
    ctx.transitions.progressRun(job.runId, job.source, { done: 0, total: targets.length });
    const baseFetch: FetchLike = ctx.fetchFn ?? ((url) => fetch(url));
    for (const appid of targets) {
      if (stopped) break;
      const { signal, release } = trackController();
      try {
        const authed = createSteamRequest({
          keyPath: ctx.keyPath,
          baseUrl: ctx.baseUrl,
          fetchFn: (url) => raceWithSignal(baseFetch(url), signal),
        });
        let collected;
        try {
          const result = await raceWithSignal(
            authed.request((key, base) => buildPlayerAchievementsPath(key, steamId, appid, base)),
            signal,
          );
          if (!result.ok) {
            finishFailed(job, result.code, result.params);
            return;
          }
          const verdict = judgeAchievementsResponse(result.status, result.body, Number(appid));
          if (verdict.kind === 'failSource') {
            finishFailed(job, verdict.code, verdict.params);
            return;
          }
          collected = toCollectedAchievements(verdict, normalizePlayerAchievements(result.body));
        } catch (error) {
          if (signal.aborted) return; // stop — running 유지, recover가 잇는다
          if (error instanceof DOMException && error.name === 'AbortError') return;
          finishFailed(job, 'PAYLOAD_CORRUPT', {});
          return;
        }
        saveCollectedAchievements(
          ctx.db,
          { platform: 'steam', externalId: appid },
          collected,
          { observedAt: Math.floor(now() / 1000), syncRunId: job.runId },
        );
      } finally {
        release();
      }
      if (stopped) break; // 중단된 항목은 체크포인트 없이 recover 대상에 둔다
      writeCheckpoint(ctx.db, {
        generation: job.generation,
        source: job.source,
        itemKey: itemKey('steam', appid, job.source),
        syncRunId: job.runId,
        doneAt: Math.floor(now() / 1000),
      });
      ctx.transitions.progressRun(job.runId, job.source, {
        done: checkpointDone(ctx.db, job),
        total: targets.length,
      });
    }
    if (stopped) return; // running 유지·recover 대상. held로 끝내지 않는다.
    ctx.transitions.finishSyncRun(job.runId, job.source, {
      status: 'ok',
      finishedAt: Math.floor(now() / 1000),
      itemCount: targets.length,
      isFinalized: true,
      issue: null,
    });
  }

  async function runSteamspy(job: CollectJob): Promise<void> {
    const targets = buildQueue(ctx.db, { source: job.source, generation: job.generation, mode: job.mode }).map(
      (key) => key.split(':')[1],
    );
    ctx.transitions.progressRun(job.runId, job.source, { done: 0, total: targets.length });
    const spyDir = join(dirname(ctx.cacheDir), STEAMSPY_CACHE_DIR_NAME);
    const baseFetch: FetchLike = ctx.fetchFn ?? ((url) => fetch(url));
    for (const appid of targets) {
      if (stopped) break;
      const { signal, release } = trackController();
      try {
        const collected = await fetchSteamSpyUserTags({
          appId: appid,
          cacheDir: spyDir,
          signal,
          fetchFn: (url, init) => raceWithSignal(baseFetch(url), init.signal),
          clock: steamSpyTestHooks?.clock,
          limiter: steamSpyTestHooks?.limiter ?? spyLimiter,
          baseUrl: ctx.steamSpyBaseUrl,
        });
        saveCollectedTags(
          ctx.db,
          { platform: 'steam', externalId: appid },
          collected,
          { observedAt: Math.floor(now() / 1000), syncRunId: job.runId },
        );
      } catch {
        if (signal.aborted && stopped) break;
      } finally {
        release();
      }
      if (stopped) break; // 중단된 항목은 체크포인트 없이 recover 대상에 둔다
      writeCheckpoint(ctx.db, {
        generation: job.generation,
        source: job.source,
        itemKey: itemKey('steam', appid, job.source),
        syncRunId: job.runId,
        doneAt: Math.floor(now() / 1000),
      });
      ctx.transitions.progressRun(job.runId, job.source, {
        done: checkpointDone(ctx.db, job),
        total: targets.length,
      });
    }
    if (stopped) return; // running 유지·recover 대상. held로 끝내지 않는다.
    ctx.transitions.finishSyncRun(job.runId, job.source, {
      status: 'ok',
      finishedAt: Math.floor(now() / 1000),
      itemCount: targets.length,
      isFinalized: true,
      issue: null,
    });
  }

  async function runMeta(job: CollectJob): Promise<void> {
    if (job.locale === null) {
      ctx.transitions.finishSyncRun(job.runId, job.source, {
        status: 'ok',
        finishedAt: Math.floor(now() / 1000),
        itemCount: 0,
        isFinalized: true,
        issue: null,
      });
      return;
    }
    const targets = buildQueue(ctx.db, { source: job.source, generation: job.generation, mode: job.mode }).map(
      (key) => key.split(':')[1],
    );
    ctx.transitions.progressRun(job.runId, job.source, { done: 0, total: targets.length });
    let failedItems = 0;
    for (const appid of targets) {
      if (stopped) break;
      const { signal, release } = trackController();
      try {
        const result = await fetchAppMetaStatus(appid, {
          cacheDir: ctx.cacheDir,
          locale: job.locale as 'ko' | 'en',
          baseUrl: ctx.storeBaseUrl,
          fetchFn: (url: string, init: { signal: AbortSignal }) =>
            raceWithSignal(authedFetch(init.signal)(url), init.signal).then(
              (res) =>
                ({
                  status: res.status,
                  ok: res.status >= 200 && res.status < 300,
                  json: () => res.json(),
                }) as Response,
            ),
          now,
          signal,
        });
        persistMeta(ctx.db, appid, result.meta, job);
        if (result.state === 'failed') failedItems += 1;
      } catch {
        if (signal.aborted && stopped) break;
        failedItems += 1;
      } finally {
        release();
      }
      writeCheckpoint(ctx.db, {
        generation: job.generation,
        source: job.source,
        itemKey: itemKey('steam', appid, job.source),
        syncRunId: job.runId,
        doneAt: Math.floor(now() / 1000),
      });
      ctx.transitions.progressRun(job.runId, job.source, {
        done: checkpointDone(ctx.db, job),
        total: targets.length,
      });
    }
    if (stopped) return; // running 유지·recover 대상. held로 끝내지 않는다.
    ctx.transitions.finishSyncRun(job.runId, job.source, {
      status: 'ok',
      finishedAt: Math.floor(now() / 1000),
      itemCount: targets.length,
      isFinalized: true,
      issue: null,
      failedItems,
    });
  }

  function checkpointDone(db: Database.Database, job: CollectJob): number {
    return (
      drizzle(db)
        .select({ itemKey: checkpoints.itemKey })
        .from(checkpoints)
        .where(eq(checkpoints.generation, job.generation))
        .all()
        .filter((row) => row.itemKey.endsWith(`:${job.source}`))
    ).length;
  }

  function persistMeta(
    _db: Database.Database,
    _appid: string,
    _meta: { name?: string },
    _job: CollectJob,
  ): void {
    // D-06 후속: game_genres·meta_states 기록. 현 범위 밖이라 두지 않는다.
  }

  return {
    enqueue: (job: CollectJob): void => {
      queue.push(job);
      void pump();
    },
    recover: async (): Promise<void> => {
      const rows = ctx.db
        .prepare("SELECT id, source FROM sync_runs WHERE status = 'running' ORDER BY id")
        .all() as { id: number; source: CollectSource }[];
      const locale = readLastCollectLocale(ctx.db);
      for (const row of rows) {
        const gen = ctx.db
          .prepare('SELECT generation FROM sync_generations WHERE source = ?')
          .get(row.source) as { generation: number } | undefined;
        queue.push({
          runId: row.id,
          source: row.source,
          generation: gen ? gen.generation : 0,
          mode: 'resume',
          locale,
        });
      }
      void pump(); // 완료를 기다리지 않고 깨우기만 한다
    },
    stop: async (): Promise<void> => {
      stopped = true;
      for (const ctrl of controllers) {
        ctrl.abort();
      }
      const deadline = Date.now() + STOP_TIMEOUT_MS;
      while (inFlight.size > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  };
}
