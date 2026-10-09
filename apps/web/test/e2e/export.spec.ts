import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServerApp } from '../../src/server/app.js';
import { startServer, type StartedServer } from '../../src/server/serve.js';
import { uiDistDir } from '../../src/server/static.js';

/**
 * W-export E2E — 성공 1건(임시 db + exportDir 주입). 클립보드 클릭은 제외(수동 확인).
 */
test.use({ locale: 'ko-KR' });

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let started: StartedServer;
let dir: string;
let db: Database.Database;
let exportDir: string;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'questail-export-e2e-'));
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
  db.prepare(
    'INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)',
  ).run('steam', '990011', 'canary-export-game');
  db.prepare(
    'INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('steam', '990011', 'observed', 1700000000, 0, 0);
  exportDir = join(dir, 'export');
  started = await startServer(
    createServerApp({ staticRoot: uiDistDir(), exportDeps: { db, exportDir } }),
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

test('내보내기 성공 → 완료 문구 + 파일 생성', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${started.port}/export`);
  await page.getByRole('button', { name: 'Markdown으로 내보내기' }).click();
  await expect(page.getByText('1개 파일을 만들었어요')).toBeVisible();
  expect(readdirSync(exportDir).length).toBeGreaterThan(0);
});
