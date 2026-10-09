import { expect, test } from '@playwright/test';
import { stopServer } from './helpers.js';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServerApp } from '../../src/server/app.js';
import { startServer, type StartedServer } from '../../src/server/serve.js';
import { uiDistDir } from '../../src/server/static.js';

/** U1-F3 <html lang> = 표시 언어. settings.spec 확장과 충돌을 피해 별도 파일. */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test.use({ locale: 'en-US' });

let started: StartedServer;
let db: Database.Database;
let dir: string;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'questail-u1f3-e2e-'));
  const journal = JSON.parse(
    readFileSync(join(WEB, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const setup = new Database(join(dir, 'questail.db'));
  try {
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
  await stopServer(started);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('en 첫 진입 → html lang="en"', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${started.port}/settings`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('설정 전환 en→ko 후 lang="ko"', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${started.port}/settings`);
  await page.getByRole('button', { name: '한국어' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
});
