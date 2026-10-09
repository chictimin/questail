import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServerApp } from '../../src/server/app.js';
import { startServer, type StartedServer } from '../../src/server/serve.js';
import { uiDistDir } from '../../src/server/static.js';
import { applyJournal, seedPerfDb } from './seed.js';

/**
 * W10b perf 하네스 — 시드 DB + in-process 실서버. env 의존 동작이 없어
 * pnpm start가 필요 없고 같은 프로세스 그룹이라 정리가 trivial하다.
 */
export interface PerfServer {
  baseUrl: string;
  db: Database.Database;
  dir: string;
  started: StartedServer;
  count: number;
}

export async function startPerfServer(): Promise<PerfServer> {
  const dir = mkdtempSync(join(tmpdir(), 'questail-perf-'));
  const dbPath = join(dir, 'questail.db');
  applyJournal(dbPath);
  const db = new Database(dbPath);
  const { games } = seedPerfDb(db);
  const started = await startServer(
    createServerApp({
      staticRoot: uiDistDir(),
      exportDeps: { db, exportDir: join(dir, 'export') },
    }),
    0,
  );
  return { baseUrl: `http://127.0.0.1:${started.port}`, db, dir, started, count: games };
}

export async function stopPerfServer(server: PerfServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.started.server.close((error: Error | undefined) =>
      error ? reject(error) : resolve(),
    );
  });
  server.db.close();
  rmSync(server.dir, { recursive: true, force: true });
}
