/**
 * W3 기동 순서 — 1 데이터 디렉터리 해석 → 2 백업(실패 시 중단) → 3 마이그레이션(실패 시 중단)
 * → 4 listen → 5 백그라운드(막지 않음) → 6 종료(신호→shutdown, main.ts).
 * A 함수(백업·마이그레이션·잡·스냅샷·cron·DB)는 BootDeps 주입 + 스텁. apps/web/src/{db,data,jobs}/는 A 소유라 만들지 않는다.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';
import type { ServerType } from '@hono/node-server';
import { createServerApp } from './app.js';
import { resolvePort, startServer, type StartedServer } from './serve.js';

/** 데이터 디렉터리 환경변수 (PM 확정). 기본 = 저장소 루트 data/ (캡틴 결정, PM #61920). */
export const DATA_DIR_ENV = 'QUESTAIL_DATA_DIR';
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

/** 1단계 — 환경변수, 없으면 기본 위치. */
export function resolveDataDir(
  env: NodeJS.ProcessEnv = process.env,
  fromDir?: string,
): string {
  const raw = env[DATA_DIR_ENV];
  return raw === undefined || raw === '' ? defaultDataDir(fromDir) : raw;
}

export type Cancellable = { cancel: () => void | Promise<void> };
export type CronHandle = { unregister: () => void };
export type BootDatabase = { close: () => Promise<void> };

export type BootDeps = {
  backupDatabase: (dataDir: string) => Promise<void>;
  migrateDatabase: (dataDir: string) => Promise<BootDatabase>;
  recoverInterruptedJobs: (signal: AbortSignal) => Promise<void>;
  isConnected: () => boolean | Promise<boolean>;
  runOverdueSnapshot: (signal: AbortSignal) => Promise<void>;
  registerCron: () => CronHandle;
  createApp?: () => Hono;
  listen?: (app: Hono, port: number) => Promise<StartedServer>;
  env?: NodeJS.ProcessEnv;
};

export type BootedServer = {
  server: ServerType;
  port: number;
  /** 5단계 — 느리거나 throw해도 listen·반환은 완료한다. */
  background: Promise<void>;
  /** abort → background 정착 대기 → cron 해제 → DB close. 두 번 호출해도 1회만. */
  shutdown: () => Promise<void>;
};

export async function boot(deps: BootDeps): Promise<BootedServer> {
  const env = deps.env ?? process.env;
  const dataDir = resolveDataDir(env);
  await deps.backupDatabase(dataDir);
  const db = await deps.migrateDatabase(dataDir);
  const app = (deps.createApp ?? createServerApp)();
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
      controller.abort();
      await background.then(
        () => undefined,
        () => undefined,
      );
      state.cron?.unregister();
      state.cron = undefined;
      await db.close();
    })();
    return shutdownOnce;
  };

  return { server, port, background, shutdown };
}
