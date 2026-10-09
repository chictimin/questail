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
  db
    .prepare('INSERT INTO account (id, steam_id, created_at) VALUES (?, ?, ?)')
    .run(1, '76561198000000001', 1700000000);
  started = await startServer(
    createServerApp({
      staticRoot: uiDistDir(),
      exportDeps: { db, exportDir: join(dir, 'export') },
      connectDeps: { db, keyPath: join(dir, 'steam.key') },
      settingsDeps: { dataDir: dir, version: '0.1.0-test' },
    }),
    0,
  );
});

test.afterAll(async () => {
  await stopServer(started);
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
    expect(await page.content()).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  test('언어 변경 → 이전 언어 유지 안내', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${started.port}/settings`);
    await page.getByRole('button', { name: 'English' }).click();
    // 표시 언어가 바뀌어 안내는 영어로 보인다.
    await expect(page.getByRole('status')).toHaveText(
      'Previously fetched game info stays in the earlier language until it is fetched again.',
    );
  });

  test('연결 섹션 → 고정 표시 + 거부 대화상자 + 키 행', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${started.port}/settings`);
    await expect(page.getByText('76561198000000001')).toBeVisible();
    await expect(page.getByText('고정')).toBeVisible();
    await page.getByRole('button', { name: '다른 계정으로 바꾸기' }).click();
    await expect(
      page.getByText('이 데이터 폴더에는 다른 계정을 연결할 수 없어요'),
    ).toBeVisible();
    await expect(page.getByText('한 데이터 폴더는 한 Steam 계정만 기록해요.')).toBeVisible();
    await page.getByRole('button', { name: '확인' }).click();
    await expect(page.getByText('저장됨')).toBeVisible();
    await page.getByRole('button', { name: '다른 계정으로 바꾸기' }).click();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: '다른 계정으로 바꾸기' }),
    ).toBeFocused();
    await expect(page.getByRole('link', { name: 'Steam 키 페이지' })).toHaveAttribute(
      'href',
      'https://steamcommunity.com/dev/apikey',
    );
    await expect(page.getByRole('link', { name: '키 교체' })).toHaveAttribute(
      'href',
      '/connect',
    );
  });

  test('정보 섹션 → 버전 + MIT', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${started.port}/settings`);
    await expect(page.getByText('0.1.0-test')).toBeVisible();
    await expect(page.getByText('MIT', { exact: true })).toBeVisible();
  });
});
