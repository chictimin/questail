import { expect, test } from '@playwright/test';
import { startPerfServer, stopPerfServer } from './harness.js';

/**
 * W10b ① 행 DOM ≤ 60 (합성 5,000건).
 * 보수 기준: 총 game-row 노드 ≤ 60 (FE: 화면행 + 오버스캔 + 포커스 여유).
 */
test.use({ locale: 'ko-KR' });

test('5,000건 리스트 game-row 노드 ≤ 60', async ({ page }) => {
  test.setTimeout(300000);
  const server = await startPerfServer();
  try {
    expect(server.count).toBe(5000);
    await page.goto(`${server.baseUrl}/library`);
    await expect(page.locator('li[data-game-key]').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    const rows = await page.locator('li[data-game-key]').count();
    expect(rows).toBeLessThanOrEqual(60);
  } finally {
    await stopPerfServer(server);
  }
});
