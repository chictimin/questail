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
    expect(await page.content()).not.toMatch(/\{[a-zA-Z]+\}/);
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

  test('숨기기 → 탭 건수·행·토스트 갱신', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${seeded.port}/library`);
    await expect(page.getByRole('button', { name: '전체 2' })).toBeVisible();
    const row = page.locator('article', { hasText: 'game-100' });
    await row.getByText('행 메뉴').click();
    await row.getByRole('button', { name: '숨기기' }).click();
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
    await all.getByText('행 메뉴').click();
    await all.getByRole('button', { name: '숨기기' }).click();
    await expect(page.getByRole('button', { name: '숨긴 항목 1' })).toBeVisible();
    await page.getByRole('button', { name: '숨긴 항목 1' }).click();
    const hidden = page.locator('article', { hasText: 'game-100' });
    await hidden.getByText('행 메뉴').click();
    await hidden.getByRole('button', { name: '다시 보이기' }).click();
    await expect(page.getByRole('status')).toContainText('다시 보이게 했어요');
    await expect(
      page.getByRole('button', { name: '숨긴 항목 0' }),
    ).toBeVisible();
    await page.getByRole('button', { name: '전체 2' }).click();
    await expect(page.getByText('game-100')).toBeVisible();
  });

  test('되돌리기 → 탭·행 복원 + DB hidden 해제', async ({ page, request }) => {
    await page.goto(`http://127.0.0.1:${seeded.port}/library`);
    await expect(page.getByRole('button', { name: '전체 2' })).toBeVisible();
    const row = page.locator('article', { hasText: 'game-100' });
    await row.getByText('행 메뉴').click();
    await row.getByRole('button', { name: '숨기기' }).click();
    await expect(page.getByRole('button', { name: '숨긴 항목 1' })).toBeVisible();
    await page.getByRole('button', { name: '되돌리기' }).click();
    await expect(page.getByRole('button', { name: '전체 2' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: '숨긴 항목 0' }),
    ).toBeVisible();
    await expect(page.getByText('game-100')).toBeVisible();
    const prefs = await request.get(
      `http://127.0.0.1:${seeded.port}/api/prefs?fallback=ko`,
    );
    expect(prefs.ok()).toBe(true);
    expect(((await prefs.json()) as { hidden: unknown[] }).hidden).toEqual([]);
  });
});

test.describe('가상 스크롤 렌더 상한', () => {
  test.use({ locale: 'ko-KR', viewport: { width: 1280, height: 720 } });
  let capped: StartedServer;
  let cappedDb: Database.Database;
  let cappedDir: string;

  test.beforeEach(async () => {
    cappedDir = mkdtempSync(join(tmpdir(), 'questail-w7f4e2e-'));
    const setup = new Database(join(cappedDir, 'questail.db'));
    try {
      const journal = JSON.parse(
        readFileSync(join(WEB, 'drizzle', 'meta', '_journal.json'), 'utf8'),
      ) as { entries: { tag: string }[] };
      for (const entry of journal.entries) {
        setup.exec(readFileSync(join(WEB, 'drizzle', `${entry.tag}.sql`), 'utf8'));
      }
      const insertGame = setup.prepare(
        'INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)',
      );
      const insertSpan = setup.prepare(
        'INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (let i = 0; i < 300; i += 1) {
        const externalId = String(1000 + i);
        insertGame.run('steam', externalId, `game-${externalId}`);
        insertSpan.run('steam', externalId, 'observed', 1700000000, 0, 0);
      }
    } finally {
      setup.close();
    }
    cappedDb = new Database(join(cappedDir, 'questail.db'));
    capped = await startServer(
      createServerApp({
        staticRoot: uiDistDir(),
        exportDeps: { db: cappedDb, exportDir: join(cappedDir, 'export') },
      }),
      0,
    );
  });

  test.afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      capped.server.close((error: Error | undefined) =>
        error ? reject(error) : resolve(),
      );
    });
    cappedDb.close();
    rmSync(cappedDir, { recursive: true, force: true });
  });

  test('300건 중 렌더 행 ≤ 화면 행 + 60', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${capped.port}/library`);
    await expect(page.getByRole('button', { name: '전체 300' })).toBeVisible();
    const rendered = await page.locator('main[data-route="library"] article').count();
    expect(rendered).toBeLessThan(300);
    // 720px / 행 72px = 화면 10행 + 60
    expect(rendered).toBeLessThanOrEqual(70);
  });

  test('상한 후 행 메뉴 일반 클릭 가능', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${capped.port}/library`);
    await expect(page.getByRole('button', { name: '전체 300' })).toBeVisible();
    const row = page.locator('article', { hasText: 'game-1000' }).first();
    await row.getByText('행 메뉴').click();
    await expect(row.getByRole('button', { name: '숨기기' })).toBeVisible();
  });
});
