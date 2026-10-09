import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServerApp } from '../../src/server/app.js';
import { createSyncService } from '../../src/data/service.js';
import { createJobExecutor } from '../../src/data/index.js';
import { stopServer } from './helpers.js';
import { startServer, type StartedServer } from '../../src/server/serve.js';
import { uiDistDir } from '../../src/server/static.js';

/**
 * U3b [2] 수집 화면 E2E — 렌더·재수집 202·캐시 경로.
 * 실 Steam 0: achievements 경로는 fetch 없이 끝나고, meta 캐시는
 * fetchAppMetaStatus URL 하드코딩(공식 store)으로 루프백 주입이 없어
 * 캐시 파일 단언은 생략한다(근거: core/metadata/index.ts:540).
 * 409는 라우트 단위(sync-route)에서 결정적으로 본다.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let started: StartedServer;
let db: Database.Database;
let dir: string;
let dataDir: string;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'questail-sync-e2e-'));
  dataDir = join(dir, 'data');
  mkdirSync(dataDir, { recursive: true });
  const journal = JSON.parse(
    readFileSync(join(WEB, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const setup = new Database(join(dataDir, 'questail.db'));
  try {
    setup.pragma('journal_mode = WAL');
    for (const entry of journal.entries) {
      setup.exec(readFileSync(join(WEB, 'drizzle', `${entry.tag}.sql`), 'utf8'));
    }
  } finally {
    setup.close();
  }
  db = new Database(join(dataDir, 'questail.db'));
  db.prepare(
    `INSERT INTO sync_runs
      (status, source, started_at, finished_at, item_count, observed_day, is_finalized, issue_code, issue_params, generation)
     VALUES ('failed', 'owned', 1700000000, 1700000060, 0, '2024-01-01', 1, 'RATE_LIMITED', '{}', 1)`,
  ).run();
  db.prepare(
    'INSERT INTO sync_generations (source, generation) VALUES (?, ?)',
  ).run('owned', 1);
  const service = createSyncService({
    db,
    keyPath: join(dataDir, 'steam.key'),
    cacheDir: join(dataDir, 'meta'),
    timeZone: 'UTC',
    executor: createJobExecutor,
  });
  started = await startServer(
    createServerApp({
      staticRoot: uiDistDir(),
      exportDeps: { db, exportDir: join(dataDir, 'export') },
      syncService: service,
    }),
    0,
  );
});

test.afterAll(async () => {
  await stopServer(started);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test.describe('수집 상태 화면', () => {
  test.use({ locale: 'ko-KR' });
  test('/sync 렌더 + 재수집 202', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${started.port}/sync`);
    await expect(page.locator('main[data-route="sync"] h1')).toContainText('수집');
    await expect(page.locator('.sync-row').first()).toBeVisible();
    const [retryResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/sync/') &&
          response.request().method() === 'POST',
      ),
      page.getByRole('button', { name: '이것만 다시 수집' }).first().click(),
    ]);
    expect(retryResponse.status()).toBe(202);
  });

  test('캐시 디렉터리는 데이터 디렉터리 아래 (쓰기 없음 확인)', async () => {
    const response = await fetch(
      `http://127.0.0.1:${started.port}/api/sync`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: 'ko', sources: ['achievements'] }),
      },
    );
    expect(response.status).toBe(202);
    for (let i = 0; i < 60; i++) {
      const statusResponse = await fetch(
        `http://127.0.0.1:${started.port}/api/sync/status`,
      );
      const entries = (await statusResponse.json()) as {
        source: string;
        state: string;
      }[];
      const ach = entries.find((entry) => entry.source === 'achievements');
      if (ach?.state === 'ok') break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const finalResponse = await fetch(
      `http://127.0.0.1:${started.port}/api/sync/status`,
    );
    const finalEntries = (await finalResponse.json()) as {
      source: string;
      state: string;
    }[];
    expect(
      finalEntries.find((entry) => entry.source === 'achievements')?.state,
    ).toBe('ok');
    expect(readdirSync(dataDir, { recursive: true })).not.toContain('meta');
  });

  test('전체 다시 수집 → 202', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${started.port}/sync`);
    await expect(page.getByRole('button', { name: '전체 다시 수집' })).toBeVisible();
    const [collectResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/sync') &&
          response.request().method() === 'POST',
      ),
      page.getByRole('button', { name: '전체 다시 수집' }).click(),
    ]);
    expect(collectResponse.status()).toBe(202);
    await expect(page.locator('.sync-row').first()).toBeVisible();
  });
});
