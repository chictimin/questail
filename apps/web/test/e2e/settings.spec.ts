import { expect, test } from '@playwright/test';
import { stopServer } from './helpers.js';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
      '/connect?edit=1',
    );
  });

  test('정보 섹션 → 버전 + MIT', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${started.port}/settings`);
    await expect(page.getByText('0.1.0-test')).toBeVisible();
    await expect(page.getByText('MIT 라이선스')).toBeVisible();
  });
});

async function migrate(dir: string): Promise<Database.Database> {
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
  return new Database(join(dir, 'questail.db'));
}

test.describe('설정 데이터 섹션', () => {  test.use({ locale: 'ko-KR' });
  let withDir = '';
  let withDb = null as Database.Database | null;
  let withStarted = null as StartedServer | null;
  let emptyDir = '';
  let emptyDb = null as Database.Database | null;
  let emptyStarted = null as StartedServer | null;

  function boot(
    dir: string,
    db: Database.Database,
  ): Promise<StartedServer> {
    return startServer(
      createServerApp({
        staticRoot: uiDistDir(),
        exportDeps: { db, exportDir: join(dir, 'export') },
        connectDeps: { db, keyPath: join(dir, 'steam.key') },
        settingsDeps: { dataDir: dir, version: '0.1.0-test' },
      }),
      0,
    );
  }

  test.beforeAll(async () => {
    withDir = mkdtempSync(join(tmpdir(), 'questail-u53-with-'));
    withDb = await migrate(withDir);
    const backupsDir = join(withDir, 'backups');
    mkdirSync(backupsDir);
    writeFileSync(join(backupsDir, 'questail-a.db'), 'a');
    writeFileSync(join(backupsDir, 'questail-b.db'), 'b');
    writeFileSync(join(backupsDir, 'stray.txt'), 'x');
    withDb
      .prepare('INSERT INTO account (id, steam_id, created_at) VALUES (?, ?, ?)')
      .run(1, '76561198000000001', 1700000000);
    withStarted = await boot(withDir, withDb);
    emptyDir = mkdtempSync(join(tmpdir(), 'questail-u53-empty-'));
    emptyDb = await migrate(emptyDir);
    // connectDeps 없음 — status 500 fail-open으로 /settings에 머문다(미연동 리다이렉트 회피).
    emptyStarted = await startServer(
      createServerApp({
        staticRoot: uiDistDir(),
        exportDeps: { db: emptyDb, exportDir: join(emptyDir, 'export') },
        settingsDeps: { dataDir: emptyDir, version: '0.1.0-test' },
      }),
      0,
    );
  });

  test.afterAll(async () => {
    if (withStarted !== null) {
      await stopServer(withStarted);
    }
    withDb?.close();
    if (withDir !== '') {
      rmSync(withDir, { recursive: true, force: true });
    }
    if (emptyStarted !== null) {
      await stopServer(emptyStarted);
    }
    emptyDb?.close();
    if (emptyDir !== '') {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  test('with-files: 백업 2건 표시·stray 제외', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${(withStarted as StartedServer).port}/settings`);
    await expect(page.getByText('<1 MB')).toHaveCount(2);
    await expect(page.getByText('stray.txt')).toHaveCount(0);
  });

  test('empty: 자동 백업 없음 표시', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${(emptyStarted as StartedServer).port}/settings`);
    await expect(page.getByText('아직 자동 백업이 없어요')).toBeVisible();
  });

  test('연결 상태 확인 실패 시 연결 섹션(저장 표시 없음 + 키 교체 링크)', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${(emptyStarted as StartedServer).port}/settings`);
    await expect(page.getByText('저장됨')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '키 교체' })).toBeVisible();
  });

  test('대화상자 확인 → 트리거 포커스 복귀', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${(withStarted as StartedServer).port}/settings`);
    const trigger = page.getByRole('button', { name: '다른 계정으로 바꾸기' });
    await trigger.click();
    await page.getByRole('button', { name: '확인' }).click();
    await expect(trigger).toBeFocused();
  });
});
