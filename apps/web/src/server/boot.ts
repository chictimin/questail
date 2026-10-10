/**
 * W3 기동 순서 — 1 데이터 디렉터리 해석 → 2 백업(실패 시 중단) → 3 마이그레이션(실패 시 중단)
 * → 4 listen → 5 백그라운드(막지 않음) → 6 종료(신호→shutdown, main.ts).
 * A 함수(백업·마이그레이션·잡·스냅샷·cron·DB)는 BootDeps 주입 + 스텁. apps/web/src/{db,data,jobs}/는 A 소유라 만들지 않는다.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import type { ServerType } from '@hono/node-server';
import type { SyncService } from '../data/service.js';
import {
  OWNER_LOCK_BUSY_MESSAGE,
  OWNER_LOCK_UNAVAILABLE_MESSAGE,
  acquireOwnerLock,
  isOwnerLockBusy,
  type OwnerLock,
} from '../db/ownerLock.js';
import { createServerApp } from './app.js';
import { resolvePort, startServer, type StartedServer } from './serve.js';
import {
  CONNECT_DRAIN_MS,
  createAttachController,
  type AttachController,
} from './attach.js';
import { resolveDataLocation } from './dataLocation.js';
import {
  createDataHolder,
  createDataLayer,
  type DataHolder,
  type DataLayer,
} from './dataHolder.js';

/** 데이터 디렉터리 환경변수 (PM 확정). 기본 = 저장소 루트 data/ (캡틴 결정, PM #61920). */
export const DATA_DIR_ENV = 'QUESTAIL_DATA_DIR';
/**
 * 키 금지 선언 (W4) — Steam 키는 env·argv에 싣지 않는다.
 * 키는 키 파일(KEY_FILE_NAME)에만 두고 경로를 명시 주입한다.
 * process.env·process.argv를 로그·응답에 덤프하지 않는다.
 */
export const WORKSPACE_MARKER = 'pnpm-workspace.yaml';
export const DATA_DIR_NAME = 'data';

/**
 * 저장소 루트 탐색 — 모듈 위치(import.meta.url)에서 위로 올라가며
 * pnpm-workspace.yaml이 있는 디렉터리를 찾는다.
 * process.cwd() 기준이 아니다(pnpm -F 실행 시 cwd가 apps/web이 되므로, PM #61920).
 */
export function findRepoRoot(fromDir?: string): string {
  let dir =
    fromDir ?? dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, WORKSPACE_MARKER))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `[web] repo root not found (no ${WORKSPACE_MARKER}) — set the data directory with ${DATA_DIR_ENV}`,
      );
    }
    dir = parent;
  }
}

/** 기본 데이터 디렉터리 = <루트>/data. */
export function defaultDataDir(fromDir?: string): string {
  return join(findRepoRoot(fromDir), DATA_DIR_NAME);
}

/** 1단계 — 환경변수, 없으면 기본 위치. env 상대경로는 절대화(표시·동작 동일 기준). */
export function resolveDataDir(
  env: NodeJS.ProcessEnv = process.env,
  fromDir?: string,
): string {
  const raw = env[DATA_DIR_ENV];
  if (raw === undefined || raw === '') {
    return defaultDataDir(fromDir);
  }
  return resolve(raw);
}

export type Cancellable = { cancel: () => void | Promise<void> };
export type CronHandle = { unregister: () => void };
export type BootDatabase = { close: () => Promise<void> };

/** 리스너 close 유예 — 안에 끝나지 않으면 강제 절단한다(PM #62944). */
export const SHUTDOWN_GRACE_MS = 5000;

/** createApp 주입 컨텍스트 — db는 마이그레이션이 반환한 같은 open 핸들이다(PM #63860). */
export type AppContext = {
  /** 미부착(연동 전) 기동이면 undefined. */
  db: Database.Database | undefined;
  /** 해석된 데이터 폴더 D. 미부착이면 저장 예정 위치 R. */
  dataDir: string;
  /** 사용자 표시용 앱 버전 — apps/web/package.json, boot 1회 읽기. */
  version: string;
  /** U3b+W13: 라우트가 쓰는 동기 서비스. 없으면 sync 라우트 500. */
  syncService?: SyncService;
  /**
   * D16-2 holder — 현재 데이터 계층 참조. boot이 기동 시 1회 set한다
   * (이 단위에서는 항상 부착). run.ts createApp은 파생 경로를
   * ctx.dataDir가 아니라 holder에서 읽는다.
   */
  holder?: DataHolder;
  /** 미부착 기동에서만 있다 — 대기 값·connect 잠금·종료 플래그·부착 흐름(P-12). */
  attach?: AttachController;
  /** holder와 같은 값의 파생 경로(라우트·서비스 주입용, 읽기 전용). 미부착이면 없다. */
  keyPath?: string;
  cacheDir?: string;
  exportDir?: string;
};

/**
 * 웹 package.json 버전 1회 읽기. 루트 package.json에는 version이 없다.
 * 읽기에 실패하면 기동 실패(버전 없는 표시를 내보내지 않는다).
 */
export function readWebVersion(fromDir?: string): string {
  const raw = readFileSync(
    join(findRepoRoot(fromDir), 'apps', 'web', 'package.json'),
    'utf8',
  );
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== 'string' || parsed.version === '') {
    throw new Error('[web] app version check failed');
  }
  return parsed.version;
}

export type BootDeps = {
  backupDatabase: (dataDir: string) => Promise<void>;
  /**
   * D16-1 소유 잠금(P-12 ⑥) — DB 열기 전 취득·프로세스 수명 유지.
   * 미지정 시 실구현. 취득 실패 → 기동 실패(값·키·경로 원문 없음).
   */
  acquireOwnerLock?: (dataDir: string) => OwnerLock | Promise<OwnerLock>;
  migrateDatabase: (
    dataDir: string,
    opts?: { backupBeforeApply?: () => Promise<void> },
  ) => Promise<BootDatabase>;
  isConnected: (args: { db: Database.Database | undefined }) => boolean | Promise<boolean>;
  runOverdueSnapshot: (args: {
    signal: AbortSignal;
    service: SyncService | undefined;
    db: Database.Database | undefined;
    timeZone: string;
  }) => Promise<void>;
  registerCron: (args: {
    service: SyncService | undefined;
    db: Database.Database | undefined;
    timeZone: string;
  }) => CronHandle;
  /** 표시 시간대 — run.ts 1회 결정, background가 슬롯에 명시 전달한다. */
  timeZone: string;
  createApp?: (ctx: AppContext) => Hono;
  /**
   * U3b+W13: 동기 서비스 팩토리. migrate 뒤·listen 전에 1회 호출하고
   * recover()를 await한 뒤 listen한다. 없으면 복구·정지 모두 생략.
   */
  createSyncService?: (ctx: {
    db: Database.Database | undefined;
    dataDir: string;
  }) => SyncService | undefined;
  listen?: (app: Hono, port: number) => Promise<StartedServer>;
  env?: NodeJS.ProcessEnv;
  /** B 소유 — 리스너 close 유예(ms) 오버라이드, 테스트용. 미지정 시 SHUTDOWN_GRACE_MS. */
  shutdownGraceMs?: number;
  /** 종료 시 connect 잠금 해제 대기(ms) 오버라이드, 테스트용. 미지정 시 10초. */
  connectDrainMs?: number;
  /** 부착 중 PUT 대기 상한(ms) 오버라이드(시간 주입), 테스트용. 미지정 시 30초. */
  connectWaitMs?: number;
  /** ② 루트 R 오버라이드, 테스트용. 미지정 시 <저장소>/data. */
  dataRoot?: string;
};

/**
 * 동기 서비스 생명주기 — recover(복구 enqueue까지)·stop(10초 상한, throw 0).
 * SyncService 전체가 이 형태를 만족한다(구조적). boot 내부용이라 export 없음.
 */
interface SyncLifecycle {
  recover: () => Promise<void>;
  stop: () => Promise<void>;
}

export type BootedServer = {
  server: ServerType;
  port: number;
  /** 5단계 — 느리거나 throw해도 listen·반환은 완료한다. */
  background: Promise<void>;
  /**
   * ① HTTP 리스너 close(새 연결 거부) → ② abort → ③ background 정착 대기
   * → ③.5 동기 서비스 stop(10초 상한, throw 0) → ④ 확보된 cron 해제 → ⑤ DB close.
   * 두 번 호출해도 각 단계 1회만.
   */
  shutdown: () => Promise<void>;
};

export async function boot(deps: BootDeps): Promise<BootedServer> {
  const env = deps.env ?? process.env;
  // 소유 잠금(P-12 ⑥) — 취득 실패는 안내만(값·키·경로 원문 없음). 레지스트리가 프로세스 수명 동안 쥔다.
  const lockOrThrow = async (dir: string): Promise<OwnerLock> => {
    try {
      return await (deps.acquireOwnerLock ?? acquireOwnerLock)(dir);
    } catch (error) {
      throw new Error(
        isOwnerLockBusy(error)
          ? OWNER_LOCK_BUSY_MESSAGE
          : OWNER_LOCK_UNAVAILABLE_MESSAGE,
      );
    }
  };
  // 1 데이터 폴더 해석(P-12 ①~⑦) — 해석 전에 필요한 잠금(D, ②면 R도)을 DB 열기 전에 취득한다.
  const location = await resolveDataLocation(env, DATA_DIR_ENV, {
    acquireLock: lockOrThrow,
    defaultRoot: () => deps.dataRoot ?? defaultDataDir(),
  });
  const version = readWebVersion();
  const holder = createDataHolder();
  let attach: AttachController | undefined;
  let background: Promise<void> = Promise.resolve();
  let rawDb: Database.Database | undefined;
  let syncService: SyncService | undefined;
  let dataDir: string;

  if (location.mode === 'unattached') {
    // 미부착 기동 — DB·서비스·cron 없이 listen. 연동 성공 시 attach가 계층을 공개한다.
    dataDir = location.root;
    attach = createAttachController({
      root: location.root,
      version,
      timeZone: deps.timeZone,
      holder,
      backupDatabase: deps.backupDatabase,
      migrateDatabase: deps.migrateDatabase,
      createSyncService: deps.createSyncService,
      registerCron: deps.registerCron,
      acquireOwnerLock: deps.acquireOwnerLock,
      waitMs: deps.connectWaitMs,
    });
  } else {
    dataDir = location.dir;
    const db = await deps.migrateDatabase(dataDir, {
      backupBeforeApply: () => deps.backupDatabase(dataDir),
    });
    rawDb = (db as Partial<{ db: Database.Database }>).db;
    syncService = deps.createSyncService?.({ db: rawDb, dataDir });
    if (syncService !== undefined) {
      await syncService.recover();
    }
    holder.set(
      createDataLayer({ db: rawDb, bootDb: db, dataDir, version, syncService }),
    );
  }
  const initialLayer = holder.get();
  const app = (deps.createApp ?? (() => createServerApp()))({
    db: rawDb,
    dataDir,
    version,
    syncService,
    holder,
    ...(attach === undefined ? {} : { attach }),
    ...(initialLayer === undefined
      ? {}
      : {
          keyPath: initialLayer.keyPath,
          cacheDir: initialLayer.cacheDir,
          exportDir: initialLayer.exportDir,
        }),
  });
  const { server, port } = await (deps.listen ?? startServer)(
    app,
    resolvePort(env),
  );

  const controller = new AbortController();
  const signal = controller.signal;

  // 기동 부착 계층의 background — 계층을 시작 시 1회 읽고, cron도 그 계층 객체에 건다.
  if (initialLayer !== undefined) {
    const layer = initialLayer;
    background = (async (): Promise<void> => {
      if (signal.aborted) {
        return;
      }
      const connected = await deps.isConnected({ db: layer.db });
      if (signal.aborted) {
        return;
      }
      if (connected) {
        await deps.runOverdueSnapshot({
          signal,
          service: layer.syncService,
          db: layer.db,
          timeZone: deps.timeZone,
        });
      }
      if (signal.aborted) {
        return;
      }
      const cron = deps.registerCron({
        service: layer.syncService,
        db: layer.db,
        timeZone: deps.timeZone,
      });
      if (signal.aborted) {
        cron.unregister();
        return;
      }
      layer.cron = cron;
    })();
    layer.background = background;
  }

  let shutdownOnce: Promise<void> | null = null;
  const shutdown = (): Promise<void> => {
    if (shutdownOnce !== null) {
      return shutdownOnce;
    }
    shutdownOnce = (async (): Promise<void> => {
      // ① 종료 플래그 + 진행 중 connect abort → ② connect 잠금 해제 대기(상한).
      // 플래그 이후 공개 0 — attach는 5 직전에 플래그를 확인한다. 아래부터는 계층을 1회만 읽는다.
      if (attach !== undefined) {
        attach.beginShutdown();
        await attach.lock.waitIdle(deps.connectDrainMs ?? CONNECT_DRAIN_MS);
      }
      const layer: DataLayer | undefined = holder.get();
      // ③-① 리스너 close — 새 TCP 연결은 즉시 거부된다. close() 콜백은 열린
      // 연결이 끊기길 기다리느라 늦어질 수 있어, 유휴 연결을 먼저 끊고
      // 유예 안에 끝나지 않으면 전 연결을 강제 절단한다(PM #62944).
      const graceMs = deps.shutdownGraceMs ?? SHUTDOWN_GRACE_MS;
      await new Promise<void>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          (
            server as unknown as { closeAllConnections?: () => void }
          ).closeAllConnections?.();
          console.error(
            `[web] shutdown: listener close did not finish within ${graceMs}ms — forcing connections closed`,
          );
          resolve();
        }, graceMs);
        server.close(() => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve();
        });
        (
          server as unknown as { closeIdleConnections?: () => void }
        ).closeIdleConnections?.();
      });
      // ② abort → ③ background 정착 대기(연동 후 시작 작업 포함).
      controller.abort();
      await Promise.allSettled([
        background,
        ...(layer?.background === undefined ? [] : [layer.background]),
        ...(attach?.startTasks() ?? []),
      ]);
      // ③.5 동기 서비스 정지 — 리스너 close 뒤·DB close 전, 상한 10초, throw 0.
      try {
        await Promise.race([
          layer?.syncService?.stop() ?? Promise.resolve(),
          new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error('sync stop timeout')), 10000);
          }),
        ]);
      } catch {
        // 정지 실패·초과해도 종료는 계속한다
      }
      // ④ 확보된 cron 해제 → ⑤ DB close. 미부착이면 리스너만.
      if (layer !== undefined) {
        layer.cron?.unregister();
        layer.cron = undefined;
        await layer.bootDb.close();
      }
    })();
    return shutdownOnce;
  };

  return { server, port, background, shutdown };
}
