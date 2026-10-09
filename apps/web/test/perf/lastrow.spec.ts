import { expect, test, type Page } from '@playwright/test';
import { startPerfServer, stopPerfServer } from './harness.js';

/**
 * W10b ② 5,000번째 행 렌더 + 별점 입력 저장.
 * 바닥까지 스크롤해 마지막 행을 렌더한 뒤 키보드로 0.5 매김 →
 * PUT 200 → 새로고침 후 저장 정수 확인 → 같은 값 확정으로 취소 확인.
 */
test.use({ locale: 'ko-KR' });

async function scrollToBottom(page: Page): Promise<string> {
  let lastKey = '';
  let stable = 0;
  for (let i = 0; i < 60 && stable < 2; i++) {
    const key = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('li[data-game-key]')];
      const last = rows[rows.length - 1];
      last?.scrollIntoView({ block: 'end' });
      return last?.getAttribute('data-game-key') ?? '';
    });
    if (key !== '' && key === lastKey) {
      stable++;
    } else {
      stable = 0;
      lastKey = key;
    }
    await page.waitForTimeout(200);
  }
  return lastKey;
}

async function latestScore(
  page: Page,
  baseUrl: string,
  gameKey: string,
): Promise<number | null> {
  const response = await page.request.get(`${baseUrl}/api/library?includeEnded=false`);
  const games = (await response.json()) as {
    key: { platform: string; externalId: string };
    latestScore: number | null;
  }[];
  const found = games.find(
    (game) => `${game.key.platform}/${game.key.externalId}` === gameKey,
  );
  if (found === undefined) throw new Error(`행 없음: ${gameKey}`);
  return found.latestScore;
}

test('마지막 행 렌더 + 0.5 저장 + 취소', async ({ page }) => {
  test.setTimeout(300000);
  const server = await startPerfServer();
  try {
    await page.goto(`${server.baseUrl}/library`);
    await expect(page.locator('li[data-game-key]').first()).toBeVisible();
    const lastKey = await scrollToBottom(page);
    expect(lastKey).not.toBe('');
    const slider = page.locator(`li[data-game-key="${lastKey}"] [role="slider"]`);
    await slider.focus();
    // 시드 별점과 무관하게 미평가에서 시작한다.
    if ((await latestScore(page, server.baseUrl, lastKey)) !== null) {
      const [resetResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes('/api/ratings/') &&
            response.request().method() === 'PUT',
        ),
        page.keyboard.press('Delete'),
      ]);
      expect(resetResponse.status()).toBe(200);
      expect(await latestScore(page, server.baseUrl, lastKey)).toBeNull();
      await slider.focus();
    }
    const [putResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/ratings/') &&
          response.request().method() === 'PUT',
      ),
      (async () => {
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Enter');
      })(),
    ]);
    expect(putResponse.status()).toBe(200);
    await page.reload();
    await expect(page.locator('li[data-game-key]').first()).toBeVisible();
    expect(await latestScore(page, server.baseUrl, lastKey)).toBe(1);
    expect(await scrollToBottom(page)).toBe(lastKey);
    const sliderAgain = page.locator(`li[data-game-key="${lastKey}"] [role="slider"]`);
    await sliderAgain.focus();
    const [cancelResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/ratings/') &&
          response.request().method() === 'PUT',
      ),
      page.keyboard.press('Enter'),
    ]);
    expect(cancelResponse.status()).toBe(200);
    await page.reload();
    await expect(page.locator('li[data-game-key]').first()).toBeVisible();
    expect(await latestScore(page, server.baseUrl, lastKey)).toBeNull();
  } finally {
    await stopPerfServer(server);
  }
});
