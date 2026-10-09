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
import { createServerApp } from './app.js';
import { resolvePort, startServer, type StartedServer } from './serve.js';

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
        `[web] 저장소 루트를 못 찾음(${WORKSPACE_MARKER} 없음) — ${DATA_DIR_ENV}로 데이터 디렉터리를 직접 지정해라`,
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
  db: Database.Database | undefined;
  dataDir: string;
  /** 사용자 표시용 앱 버전 — apps/web/package.json, boot 1회 읽기. */
  version: string;
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
    throw new Error('[web] 앱 버전 확인 실패');
  }
  return parsed.version;
}

export type BootDeps = {
  backupDatabase: (dataDir: string) => Promise<void>;
  migrateDatabase: (dataDir: string) => Promise<BootDatabase>;
  recoverInterruptedJobs: (signal: AbortSignal) => Promise<void>;
  isConnected: () => boolean | Promise<boolean>;
  runOverdueSnapshot: (signal: AbortSignal) => Promise<void>;
  registerCron: () => CronHandle;
  createApp?: (ctx: AppContext) => Hono;
  listen?: (app: Hono, port: number) => Promise<StartedServer>;
  env?: NodeJS.ProcessEnv;
  /** B 소유 — 리스너 close 유예(ms) 오버라이드, 테스트용. 미지정 시 SHUTDOWN_GRACE_MS. */
  shutdownGraceMs?: number;
};

export type BootedServer = {
  server: ServerType;
  port: number;
  /** 5단계 — 느리거나 throw해도 listen·반환은 완료한다. */
  background: Promise<void>;
  /**
   * ① HTTP 리스너 close(새 연결 거부) → ② abort → ③ background 정착 대기
   * → ④ 확보된 cron 해제 → ⑤ DB close. 두 번 호출해도 각 단계 1회만.
   */
  shutdown: () => Promise<void>;
};

export async function boot(deps: BootDeps): Promise<BootedServer> {
  const env = deps.env ?? process.env;
  const dataDir = resolveDataDir(env);
  await deps.backupDatabase(dataDir);
  const db = await deps.migrateDatabase(dataDir);
  const rawDb = (db as Partial<{ db: Database.Database }>).db;
  const app = (deps.createApp ?? (() => createServerApp()))({
    db: rawDb,
    dataDir,
    version: readWebVersion(),
  });
  const { server, port } = await (deps.listen ?? startServer)(
    app,
    resolvePort(env),
  );

  const controller = new AbortController();
  const signal = controller.signal;
  const state: { cron?: CronHandle } = {};

  const background = (async (): Promise<void> => {
    await deps.recoverInterruptedJobs(signal);
    if (signal.aborted) {
      return;
    }
    const connected = await deps.isConnected();
    if (signal.aborted) {
      return;
    }
    if (connected) {
      await deps.runOverdueSnapshot(signal);
    }
    if (signal.aborted) {
      return;
    }
    const cron = deps.registerCron();
    if (signal.aborted) {
      cron.unregister();
      return;
    }
    state.cron = cron;
  })();

  let shutdownOnce: Promise<void> | null = null;
  const shutdown = (): Promise<void> => {
    if (shutdownOnce !== null) {
      return shutdownOnce;
    }
    shutdownOnce = (async (): Promise<void> => {
      // ① 리스너 close — 새 TCP 연결은 즉시 거부된다. close() 콜백은 열린
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
            `[web] shutdown: 리스너 close가 ${graceMs}ms 안에 끝나지 않아 연결 강제 절단`,
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
      // ② abort → ③ background 정착 대기.
      controller.abort();
      await background.then(
        () => undefined,
        () => undefined,
      );
      // ④ 확보된 cron 해제 → ⑤ DB close.
      state.cron?.unregister();
      state.cron = undefined;
      await db.close();
    })();
    return shutdownOnce;
  };

  return { server, port, background, shutdown };
}
