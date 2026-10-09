import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServerApp } from '../../src/server/app.js';
import { startServer, type StartedServer } from '../../src/server/serve.js';
import { uiDistDir } from '../../src/server/static.js';
import { EXPORT_DIR_NAME } from '../../src/server/export.js';

/** W7 ④ /library 빈 DB 렌더 1건. 시드 주행은 D-16 합성 생성기 뒤다. */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let started: StartedServer;
let db: Database.Database;
let workDir: string;

test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'questail-w7e2e-'));
  workDir = dir;
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
      exportDeps: { db, exportDir: join(dir, EXPORT_DIR_NAME) },
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
  rmSync(workDir, { recursive: true, force: true });
});

test.describe('라이브러리 빈 상태', () => {
  test.use({ locale: 'ko-KR' });
  test('/library 빈 DB → 제목 + 빈 상태', async ({ page }) => {
    const response = await page.goto(`http://127.0.0.1:${started.port}/library`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('main[data-route="library"] h1')).toContainText('라이브러리');
    await expect(page.getByText('보유한 게임이 없어요')).toBeVisible();
  });
});

test.describe('숨기기·다시 보이기 상태 갱신', () => {
  test.use({ locale: 'ko-KR' });
  let seeded: StartedServer;
  let seededDb: Database.Database;
  let seededDir: string;

  test.beforeEach(async () => {
    seededDir = mkdtempSync(join(tmpdir(), 'questail-w7f2e2e-'));
    const setup = new Database(join(seededDir, 'questail.db'));
    try {
      const journal = JSON.parse(
        readFileSync(join(WEB, 'drizzle', 'meta', '_journal.json'), 'utf8'),
      ) as { entries: { tag: string }[] };
      for (const entry of journal.entries) {
        setup.exec(readFileSync(join(WEB, 'drizzle', `${entry.tag}.sql`), 'utf8'));
      }
      for (const externalId of ['100', '200']) {
        setup
          .prepare(
            'INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)',
          )
          .run('steam', externalId, `game-${externalId}`);
        setup
          .prepare(
            'INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run('steam', externalId, 'observed', 1700000000, 0, 0);
      }
    } finally {
      setup.close();
    }
    seededDb = new Database(join(seededDir, 'questail.db'));
    seeded = await startServer(
      createServerApp({
        staticRoot: uiDistDir(),
        exportDeps: { db: seededDb, exportDir: join(seededDir, 'export') },
      }),
      0,
    );
  });

  test.afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      seeded.server.close((error: Error | undefined) =>
        error ? reject(error) : resolve(),
      );
    });
    seededDb.close();
    rmSync(seededDir, { recursive: true, force: true });
  });

  // 가상 행이 겹쳐 포인터가 가로막히면 evaluate 클릭(가상 스크롤 측정 artifact, 제품 동작 아님).
  test('숨기기 → 탭 건수·행·토스트 갱신', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${seeded.port}/library`);
    await expect(page.getByRole('button', { name: '전체 2' })).toBeVisible();
    const row = page.locator('article', { hasText: 'game-100' });
    await row.getByText('행 메뉴').evaluate((el) => (el as HTMLElement).click());
    await row.getByRole('button', { name: '숨기기' }).evaluate((el) => (el as HTMLElement).click());
    await expect(page.getByRole('status')).toContainText('숨겼어요');
    await expect(
      page.getByRole('button', { name: '숨긴 항목 1' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '전체 1' })).toBeVisible();
    await expect(page.getByText('game-100')).toHaveCount(0);
    await expect(page.getByText('game-200')).toBeVisible();
  });

  test('다시 보이기 → 탭 건수·행·토스트 갱신', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${seeded.port}/library`);
    await expect(page.getByRole('button', { name: '전체 2' })).toBeVisible();
    const all = page.locator('article', { hasText: 'game-100' });
    await all.getByText('행 메뉴').evaluate((el) => (el as HTMLElement).click());
    await all.getByRole('button', { name: '숨기기' }).evaluate((el) => (el as HTMLElement).click());
    await expect(page.getByRole('button', { name: '숨긴 항목 1' })).toBeVisible();
    await page.getByRole('button', { name: '숨긴 항목 1' }).click();
    const hidden = page.locator('article', { hasText: 'game-100' });
    await hidden.getByText('행 메뉴').evaluate((el) => (el as HTMLElement).click());
    await hidden.getByRole('button', { name: '다시 보이기' }).evaluate((el) => (el as HTMLElement).click());
    await expect(page.getByRole('status')).toContainText('다시 보이게 했어요');
    await expect(
      page.getByRole('button', { name: '숨긴 항목 0' }),
    ).toBeVisible();
    await page.getByRole('button', { name: '전체 2' }).click();
    await expect(page.getByText('game-100')).toBeVisible();
  });
});
