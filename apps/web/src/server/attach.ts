/**
 * P-12 [연동 전]·[부착]·[동시성]·[종료] — 미부착 상태의 메모리 대기 값, connect 잠금,
 * 종료 플래그, 그리고 POST /api/connect 성공 경로의 부착 흐름(1~6).
 * 원칙: 실행(recover·cron·수집)은 공개 후에만 시작한다. 공개 전 실패는 미부착 그대로,
 * 공개 후에는 되돌리지 않는다. 실패 본문·로그에 키·경로 원문을 싣지 않는다.
 */
import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { SyncErrorCode } from '@questail/core';
import {
  persistConnection,
  verifyConnection,
  type IssueParams,
  type VerifyFetchFn,
} from '../data/connection.js';
import type { SyncService } from '../data/service.js';
import { setPrefs, type Prefs } from '../data/viewState.js';
import { DB_FILE_NAME } from '../db/open.js';
import { acquireOwnerLock, type OwnerLock } from '../db/ownerLock.js';
import { preferences, viewSortState } from '../db/schema.js';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { inArray } from 'drizzle-orm';
import type { BootDatabase, CronHandle } from './boot.js';
import {
  ACCOUNT_DIR_PATTERN,
  cleanKeyTmp,
  readAccountSteamId,
} from './dataLocation.js';
import { createDataLayer, deriveDataPaths, type DataHolder } from './dataHolder.js';
import { createLogger } from './logging.js';

/** 부착 중 PUT 대기 상한(ms) — 초과하면 409 CONNECT_IN_PROGRESS·쓰기 0. */
export const CONNECT_WAIT_MS = 30_000;
/** 종료 시 connect 잠금 해제 대기 상한(ms). */
export const CONNECT_DRAIN_MS = 10_000;

export type ConnectLock = {
  /** 잡으면 해제 함수, 이미 잡혀 있으면 null. */
  tryAcquire: () => (() => void) | null;
  isHeld: () => boolean;
  /** 해제까지 최대 ms 대기. 풀렸으면 true, 초과하면 false. true 직후 같은 동기 구간에서 쓴다. */
  waitIdle: (ms: number) => Promise<boolean>;
};

export function createConnectLock(): ConnectLock {
  let held = false;
  let waiters: Array<() => void> = [];
  return {
    tryAcquire: () => {
      if (held) {
        return null;
      }
      held = true;
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        held = false;
        const wake = waiters;
        waiters = [];
        for (const fn of wake) {
          fn();
        }
      };
    },
    isHeld: () => held,
    waitIdle: async (ms: number) => {
      const deadline = Date.now() + ms;
      while (held) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          return false;
        }
        const woke = await new Promise<boolean>((resolve) => {
          const wake = (): void => {
            clearTimeout(timer);
            resolve(true);
          };
          const timer = setTimeout(() => {
            waiters = waiters.filter((w) => w !== wake);
            resolve(false);
          }, remaining);
          waiters.push(wake);
        });
        if (!woke) {
          return !held;
        }
      }
      return true;
    },
  };
}

type SortEntry = { filterKey: string; sortKey: string; direction: 'asc' | 'desc' };

/** 연동 전 PUT이 쌓는 프로세스 메모리 대기 값(재시작하면 사라진다). */
export type PendingValues = {
  locale?: 'ko' | 'en';
  hideShortPlaytime?: boolean;
  sortPerFilter: Map<string, SortEntry>;
  achievementsEnabled?: boolean;
};

export function readPendingPrefs(pending: PendingValues, fallback: 'ko' | 'en'): Prefs {
  return {
    locale: pending.locale ?? fallback,
    hidden: [],
    sortPerFilter: [...pending.sortPerFilter.values()],
    hideShortPlaytime: pending.hideShortPlaytime ?? false,
  };
}

export function writePendingPrefs(
  pending: PendingValues,
  patch: {
    locale?: 'ko' | 'en';
    hideShortPlaytime?: boolean;
    sortPerFilter?: SortEntry[];
  },
): void {
  if (patch.locale !== undefined) {
    pending.locale = patch.locale;
  }
  if (patch.hideShortPlaytime !== undefined) {
    pending.hideShortPlaytime = patch.hideShortPlaytime;
  }
  for (const entry of patch.sortPerFilter ?? []) {
    pending.sortPerFilter.set(entry.filterKey, { ...entry });
  }
}

/**
 * 대기 값(achievements 제외)을 DB 트랜잭션 안에서 쓰고 되돌림 함수를 돌려준다.
 * 대기 값이 없는 키는 건드리지 않는다(기본값으로 덮지 않음).
 */
function pendingExtraWrites(
  pending: PendingValues,
): ((db: Database.Database) => () => void) | undefined {
  const hasAny =
    pending.locale !== undefined ||
    pending.hideShortPlaytime !== undefined ||
    pending.sortPerFilter.size > 0;
  if (!hasAny) {
    return undefined;
  }
  const patch = {
    ...(pending.locale === undefined ? {} : { locale: pending.locale }),
    ...(pending.hideShortPlaytime === undefined
      ? {}
      : { hideShortPlaytime: pending.hideShortPlaytime }),
    ...(pending.sortPerFilter.size === 0
      ? {}
      : { sortPerFilter: [...pending.sortPerFilter.values()] }),
  };
  return (db) => {
    const orm = drizzle(db);
    const prevPrefs = orm
      .select()
      .from(preferences)
      .where(inArray(preferences.key, ['locale', 'hide_short_playtime']))
      .all();
    const prevSort = orm.select().from(viewSortState).all();
    setPrefs(db, patch);
    return () => {
      const undo = drizzle(db);
      undo.delete(preferences).where(inArray(preferences.key, ['locale', 'hide_short_playtime'])).run();
      for (const row of prevPrefs) {
        undo.insert(preferences).values(row).run();
      }
      undo.delete(viewSortState).run();
      for (const row of prevSort) {
        undo.insert(viewSortState).values(row).run();
      }
    };
  };
}

export type AttachDeps = {
  root: string;
  version: string;
  timeZone: string;
  holder: DataHolder;
  backupDatabase: (dataDir: string) => Promise<void>;
  migrateDatabase: (
    dataDir: string,
    opts?: { backupBeforeApply?: () => Promise<void> },
  ) => Promise<BootDatabase>;
  createSyncService?: (ctx: {
    db: Database.Database | undefined;
    dataDir: string;
  }) => SyncService | undefined;
  registerCron: (args: {
    service: SyncService | undefined;
    db: Database.Database | undefined;
    timeZone: string;
  }) => CronHandle;
  acquireOwnerLock?: (dir: string) => OwnerLock | Promise<OwnerLock>;
  /** 부착 중 PUT 대기 상한 오버라이드(테스트 시간 주입). */
  waitMs?: number;
};

export type ConnectInput = {
  keyText: string;
  steamId: string;
  achievementsEnabled?: boolean;
  fetchFn?: VerifyFetchFn;
  baseUrl?: string;
  signal?: AbortSignal;
};

export type ConnectOutcome =
  | { ok: true }
  | { ok: false; code: SyncErrorCode; params: IssueParams };

export type AttachController = {
  root: string;
  version: string;
  lock: ConnectLock;
  pending: PendingValues;
  /** connect 진행 중 Steam 요청을 끊는 종료 신호. */
  signal: AbortSignal;
  waitMs: number;
  isShuttingDown: () => boolean;
  /** 종료 플래그를 세우고 진행 중 connect를 abort한다. */
  beginShutdown: () => void;
  /** 등록된 시작 작업(6) — shutdown이 정착을 기다린다. */
  startTasks: () => Promise<void>[];
  /** 잠금을 잡은 상태에서 부른다(1~5). 8 vanity 해석은 호출 측. */
  connect: (input: ConnectInput) => Promise<ConnectOutcome>;
};

/** 로그용 원인 코드 — 오류의 code가 대문자 식별자 형태일 때만, 아니면 UNKNOWN(메시지·경로 원문 0). */
function causeCode(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : 'UNKNOWN';
}

function failure(
  reason: 'io' | 'permission' | 'dir_conflict' | 'attach' | 'shutdown',
): ConnectOutcome {
  return { ok: false, code: 'KEY_STORE_FAILED', params: { reason } };
}

export function createAttachController(deps: AttachDeps): AttachController {
  const lock = createConnectLock();
  const abort = new AbortController();
  const pending: PendingValues = { sortPerFilter: new Map() };
  const tasks: Promise<void>[] = [];
  const log = createLogger();
  const acquire = deps.acquireOwnerLock ?? acquireOwnerLock;
  let shuttingDown = false;
  const stopped = (): boolean => shuttingDown;

  const rmQuiet = (path: string): void => {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      /* 정리 실패는 ⑤가 다음 기동에 다시 시도한다 */
    }
  };
  const closeQuiet = async (handle: BootDatabase | undefined): Promise<void> => {
    try {
      await handle?.close();
    } catch {
      /* 닫기 실패는 무시한다 */
    }
  };

  /** 2 — T 판정(읽기만). */
  async function judge(
    target: string,
    steamId: string,
  ): Promise<'new' | 'existing' | 'conflict'> {
    if (!existsSync(target)) {
      return 'new';
    }
    try {
      const dbPath = join(target, DB_FILE_NAME);
      if (!statSync(target).isDirectory() || !statSync(dbPath).isFile()) {
        return 'conflict';
      }
      if (readAccountSteamId(dbPath) !== steamId) {
        return 'conflict';
      }
      await acquire(target);
      return 'existing';
    } catch {
      return 'conflict';
    }
  }

  /** 6 — 공개 뒤 시작 작업(recover → cron 등록). 실패는 로그 1줄, 공개 상태 유지. */
  function startAfterPublish(
    layer: ReturnType<typeof createDataLayer>,
  ): void {
    const task = (async (): Promise<void> => {
      let stage: 'recover' | 'cron' = 'recover';
      try {
        await layer.syncService?.recover();
        if (stopped()) {
          return;
        }
        stage = 'cron';
        const cron = deps.registerCron({
          service: layer.syncService,
          db: layer.db,
          timeZone: deps.timeZone,
        });
        if (stopped()) {
          cron.unregister();
          return;
        }
        layer.cron = cron;
      } catch (error) {
        log.error(`[web] 연동 후 시작 실패 source=${stage} code=${causeCode(error)}`);
      }
    })();
    layer.background = task;
    tasks.push(task);
  }

  async function connect(input: ConnectInput): Promise<ConnectOutcome> {
    // 0 — 비형식 ID는 Steam 요청 전에 거부한다(방어용, 호출 측 라우트도 같은 검사를 먼저 한다).
    if (!ACCOUNT_DIR_PATTERN.test(input.steamId)) {
      return { ok: false, code: 'AUTH_ID_MISMATCH', params: { reason: 'not_found' } };
    }
    // 1 — 검증(쓰기 0). 고정 ID 충돌은 폴더 판정이 대신한다(기존 폴더는 steam_id 일치만 통과).
    const verified = await verifyConnection({
      keyText: input.keyText,
      steamId: input.steamId,
      fetchFn: input.fetchFn,
      signal: input.signal ?? abort.signal,
      baseUrl: input.baseUrl,
    });
    if (!verified.ok) {
      return verified;
    }
    const steamId = input.steamId;
    // 2 — 대상 T 판정.
    const target = join(deps.root, steamId);
    const kind = await judge(target, steamId);
    if (kind === 'conflict') {
      return failure('dir_conflict');
    }
    // 잠금 안 대기 값 스냅샷 — 이 시점 이후 PUT은 잠금 해제까지 대기한다.
    // 이번 요청 body 명시값 > 연동 전 PUT 대기 값 > 기존 DB 값(없으면 불변).
    const effectiveAch = input.achievementsEnabled ?? pending.achievementsEnabled;
    const extraWrites = pendingExtraWrites(pending);
    let handle: (BootDatabase & { db?: Database.Database }) | undefined;

    if (kind === 'new') {
      // 3N — 스테이징 S에서 완성 후 rename(S→T) 1회.
      if (stopped()) {
        return failure('io');
      }
      const staging = join(
        deps.root,
        `.staging-${steamId}-${process.pid}-${randomBytes(4).toString('hex')}`,
      );
      let staged: (BootDatabase & { db?: Database.Database }) | undefined;
      try {
        mkdirSync(staging, { recursive: true });
        staged = await deps.migrateDatabase(staging);
        const raw = staged.db;
        if (raw === undefined) {
          throw new Error('no db');
        }
        const saved = persistConnection({
          db: raw,
          keyPath: deriveDataPaths(staging).keyPath,
          key: verified.key,
          steamId,
          achievementsEnabled: effectiveAch,
          extraWrites,
        });
        if (!saved.ok) {
          await closeQuiet(staged);
          staged = undefined;
          rmQuiet(staging);
          return saved;
        }
        await staged.close();
        staged = undefined;
        if (stopped()) {
          rmQuiet(staging);
          return failure('io');
        }
        renameSync(staging, target);
      } catch {
        await closeQuiet(staged);
        rmQuiet(staging);
        return failure('io');
      }
    } else {
      // 3E — (a) 백업 → (b) 스키마 마이그레이션 → (c) 키·옵션(P-11 #5).
      cleanKeyTmp(target);
      if (stopped()) {
        return failure('io');
      }
      try {
        await deps.backupDatabase(target);
      } catch {
        return failure('io');
      }
      if (stopped()) {
        return failure('io');
      }
      try {
        handle = await deps.migrateDatabase(target);
      } catch {
        return failure('io');
      }
      if (stopped() || handle.db === undefined) {
        await closeQuiet(handle);
        return failure('io');
      }
      const saved = persistConnection({
        db: handle.db,
        keyPath: deriveDataPaths(target).keyPath,
        key: verified.key,
        steamId,
        achievementsEnabled: effectiveAch,
        extraWrites,
      });
      if (!saved.ok) {
        await closeQuiet(handle);
        return saved;
      }
    }

    // 4 — 준비(실행 0). 여기부터 저장은 끝났으므로 실패는 reason=attach·shutdown.
    if (stopped()) {
      await closeQuiet(handle);
      return failure('shutdown');
    }
    let prepared: ReturnType<typeof createDataLayer> | undefined;
    try {
      if (kind === 'new') {
        await acquire(target);
        handle = await deps.migrateDatabase(target);
      }
      const opened = handle as BootDatabase & { db?: Database.Database };
      const raw = opened.db;
      if (raw === undefined) {
        throw new Error('no db');
      }
      const service = deps.createSyncService?.({ db: raw, dataDir: target });
      prepared = createDataLayer({
        db: raw,
        bootDb: opened,
        dataDir: target,
        version: deps.version,
        syncService: service,
      });
    } catch {
      await closeQuiet(handle);
      return failure('attach');
    }
    // 5 — 공개. 종료 진행 중이면 준비 계층을 닫고 shutdown.
    if (stopped()) {
      await closeQuiet(prepared.bootDb);
      return failure('shutdown');
    }
    deps.holder.set(prepared);
    // 6 — 시작 작업은 응답과 무관하게 background로.
    startAfterPublish(prepared);
    return { ok: true };
  }

  return {
    root: deps.root,
    version: deps.version,
    lock,
    pending,
    signal: abort.signal,
    waitMs: deps.waitMs ?? CONNECT_WAIT_MS,
    isShuttingDown: () => shuttingDown,
    beginShutdown: () => {
      shuttingDown = true;
      abort.abort();
    },
    startTasks: () => tasks.slice(),
    connect,
  };
}
