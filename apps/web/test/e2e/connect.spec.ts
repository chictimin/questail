import { expect, test } from '@playwright/test';
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
 * W5 /connect E2E 1건 — 형태 오류 제출 → 원인 문구 표시.
 * 성공 제출은 제외: 서버의 Steam 검증 fetch는 주입 불가라 실호출이 나가기 때문.
 */
test.use({ locale: 'ko-KR' });

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let started: StartedServer;
let dir: string;
let db: Database.Database;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'questail-w5-e2e-'));
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
      connectDeps: { db, keyPath: connectKeyPath(dir) },
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

test('형태 오류 키 제출 → 원인 문구 표시', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${started.port}/connect`);
  await page.getByLabel('API 키').fill('not-a-key');
  await page.getByLabel('Steam ID').fill('76561198000000001');
  await page.getByRole('button', { name: '연동하기' }).click();
  await expect(page.getByRole('alert')).toHaveText('키가 올바르지 않다');
});
