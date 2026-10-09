import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServerApp } from '../../src/server/app.js';
import { startServer, type StartedServer } from '../../src/server/serve.js';
import { uiDistDir } from '../../src/server/static.js';

/** W8 ② /settings 빈 DB 렌더 1건 (제목·업적 꺼짐·언어). */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let started: StartedServer;
let db: Database.Database;
let dir: string;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'questail-w8-e2e-'));
  const journal = JSON.parse(
    readFileSync(join(WEB, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const setup = new Database(join(dir, 'questail.db'));
  try {
    setup.pragma('journal_mode = WAL');
    for (const entry of journal.entries) {
      setup.exec(readFileSync(join(WEB, 'drizzle', `${entry.tag}.sql`), 'utf8'));
    }
  } finally {
    setup.close();
  }
  db = new Database(join(dir, 'questail.db'));
  started = await startServer(
    createServerApp({
      staticRoot: uiDistDir(),
      exportDeps: { db, exportDir: join(dir, 'export') },
    }),
    0,
  );
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    started.server.close((error: Error | undefined) =>
      error ? reject(error) : resolve(),
    );
  });
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test.describe('설정 빈 상태', () => {
  test.use({ locale: 'ko-KR' });
  test('/settings 빈 DB → 제목 + 업적 꺼짐 + 언어', async ({ page }) => {
    const response = await page.goto(`http://127.0.0.1:${started.port}/settings`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('main[data-route="settings"] h1')).toContainText('설정');
    await expect(page.getByText('업적 함께 물어오기')).toBeVisible();
    await expect(page.getByText('꺼짐')).toBeVisible();
    await expect(page.getByText('표시 언어')).toBeVisible();
  });
});
