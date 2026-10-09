import { expect, test } from '@playwright/test';
import { stopServer } from './helpers.js';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServerApp } from '../../src/server/app.js';
import { startServer, type StartedServer } from '../../src/server/serve.js';
import { connectKeyPath } from '../../src/server/routes/connect.js';
import { uiDistDir } from '../../src/server/static.js';

/**
 * U4-2 셸 — 1280/390 두 폭에서 메뉴 4개·심볼·좁은 폭 그리드 구조 단언.
 * 높이 애니메이션 금지는 동작 관찰로 단언 불가라 제외 (한계).
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let started: StartedServer;
let db: Database.Database;
let dir: string;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'questail-shell-e2e-'));
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
  db.prepare(
    'INSERT INTO account (id, steam_id, created_at) VALUES (1, ?, ?)',
  ).run('76561197960287930', 1700000000);
  started = await startServer(
    createServerApp({
      staticRoot: uiDistDir(),
      exportDeps: { db, exportDir: join(dir, 'export') },
      connectDeps: { db, keyPath: connectKeyPath(dir) },
    }),
    0,
  );
});

test.afterAll(async () => {
  await stopServer(started);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test.describe('넓은 폭 1280', () => {
  test.use({ locale: 'ko-KR', viewport: { width: 1280, height: 800 } });
  test('헤더 메뉴 4개·심볼, 모바일 숨김', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${started.port}/library`);
    const header = page.locator('header.site-header');
    await expect(header).toBeVisible();
    await expect(header.getByRole('link')).toHaveCount(4);
    await expect(header.locator('img.shell-symbol')).toBeVisible();
    await expect(page.locator('header.mobile-header')).toBeHidden();
  });
});

test.describe('좁은 폭 390', () => {
  test.use({ locale: 'ko-KR', viewport: { width: 390, height: 844 } });
  test('모바일 3칸 그리드 + 메뉴 4개, 데스크톱 숨김', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${started.port}/library`);
    const mobile = page.locator('header.mobile-header');
    await expect(mobile).toBeVisible();
    await expect(mobile.locator('.mobile-header-top > *')).toHaveCount(3);
    await expect(mobile.locator('nav.mobile-menu a')).toHaveCount(4);
    await expect(page.locator('header.site-header')).toBeHidden();
  });
});
