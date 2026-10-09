import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { boot } from '../../src/server/boot.js';
import {
  productMigrationsFolder,
  productionDeps,
} from '../../src/server/deps.js';
import { HEALTH_PATH } from '../../src/server/app.js';
import { findRepoRoot } from '../../src/server/boot.js';

const prevCwd = process.cwd();
const tempDirs: string[] = [];
afterEach(() => {
  process.chdir(prevCwd);
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 빈 TCP 포트 1개 확보 QUESTAIL_PORT용. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port =
    address !== null && typeof address === 'object' ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function tempEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), 'w3-wire-'));
  tempDirs.push(dir);
  return {
    QUESTAIL_DATA_DIR: dir,
  };
}

describe('W3 실배선 통합', () => {
  it('(a) 빈 디렉터리 기동 → DB 생성·health 200·shutdown 후 close', async () => {
    const env = tempEnv();
    env.QUESTAIL_PORT = String(await freePort());
    const booted = await boot(productionDeps(env));
    void booted.background.catch(() => undefined);
    expect(booted.port).toBe(Number(env.QUESTAIL_PORT));
    const response = await fetch(
      `http://127.0.0.1:${booted.port}${HEALTH_PATH}`,
    );
    expect(response.status).toBe(200);
    const dbPath = join(env.QUESTAIL_DATA_DIR as string, 'questail.db');
    const check = new Database(dbPath, { readonly: true });
    const migrated = check
      .prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations')
      .get() as { n: number };
    expect(migrated.n).toBeGreaterThan(0);
    check.close();
    await booted.shutdown();
    // shutdown이 리스너를 닫는다(W3-F1) — 별도 server.close 불필요.
    expect(
      (booted.server as unknown as { listening: boolean }).listening,
    ).toBe(false);
    // close 확인 — 다시 열기·읽기가 된다.
    const reopen = new Database(dbPath, { readonly: true });
    reopen.prepare('SELECT 1').get();
    reopen.close();
  });

  it('(b) 기존 DB 기동 → backups/ 백업 1개 후 기동', async () => {
    const env = tempEnv();
    env.QUESTAIL_PORT = String(await freePort());
    const first = await boot(productionDeps(env));
    void first.background.catch(() => undefined);
    await first.shutdown();
    const second = await boot(productionDeps(env));
    void second.background.catch(() => undefined);
    const backups = readdirSync(
      join(env.QUESTAIL_DATA_DIR as string, 'backups'),
    );
    expect(backups).toHaveLength(1);
    await second.shutdown();
    expect(
      (second.server as unknown as { listening: boolean }).listening,
    ).toBe(false);
  });

  it('(c) migrationsFolder가 cwd 무관하게 <루트>/apps/web/drizzle', () => {
    const root = findRepoRoot();
    process.chdir(join(root, 'apps', 'web'));
    expect(productMigrationsFolder()).toBe(
      join(root, 'apps', 'web', 'drizzle'),
    );
    process.chdir(root);
    expect(productMigrationsFolder()).toBe(
      join(root, 'apps', 'web', 'drizzle'),
    );
  });
});
