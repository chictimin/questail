import { expect, test, type Page } from '@playwright/test';
import { stopServer } from './helpers.js';
import { createServerApp } from '../../src/server/app.js';
import { startServer, type StartedServer } from '../../src/server/serve.js';
import { uiDistDir } from '../../src/server/static.js';

let started: StartedServer;

test.beforeAll(async () => {
  // dist-ui는 test 스크립트가 playwright 전에 vite build로 만든다.
  started = await startServer(
    createServerApp({ staticRoot: uiDistDir() }),
    0,
  );
});

test.afterAll(async () => {
  await stopServer(started);
});

async function gotoRoute(page: Page, route: string) {
  const response = await page.goto(`http://127.0.0.1:${started.port}${route}`);
  expect(response?.status()).toBe(200);
  await expect(page.locator(`main[data-route="${route.slice(1)}"] h1`)).toBeVisible();
}

test.describe('라우트 5개 진입', () => {
  for (const route of ['/connect', '/sync', '/library', '/settings', '/export']) {
    test(`${route} → 200 + 루트 요소`, async ({ page }) => {
      await gotoRoute(page, route);
    });
  }
});

test.describe('로케일 전환', () => {
  test.use({ locale: 'ko-KR' });
  test('ko에서 반대 언어 문자열 0', async ({ page }) => {
    await gotoRoute(page, '/library');
    await expect(page.locator('h1')).toContainText('라이브러리');
    expect(await page.content()).not.toContain('Library');
    await gotoRoute(page, '/export');
    await expect(page.locator('h1')).toContainText('내보내기');
    expect(await page.content()).not.toContain('Export');
  });
});

test.describe('로케일 전환 en', () => {
  test.use({ locale: 'en-US' });
  test('en에서 반대 언어 문자열 0', async ({ page }) => {
    await gotoRoute(page, '/library');
    await expect(page.locator('h1')).toContainText('Library');
    expect(await page.content()).not.toContain('라이브러리');
    await gotoRoute(page, '/export');
    await expect(page.locator('h1')).toContainText('Export');
    expect(await page.content()).not.toContain('내보내기');
  });
});
