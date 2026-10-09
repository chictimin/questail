import { expect, test, type Page } from '@playwright/test';
import { startPerfServer, stopPerfServer } from './harness.js';

/**
 * W10b ③ 별점 입력 시 재렌더 1행.
 * 한계 (claim에도 기록): MutationObserver는 DOM 변경 기준이라
 * DOM이 안 바뀌는 React 재렌더는 못 잡는다. 판정은 QA.
 * 제품 코드 훅 0 — 배치/mount 수는 기록만 한다.
 */
test.use({ locale: 'ko-KR' });

interface Observed {
  changedKeys: string[];
  mutationCount: number;
  addedRows: number;
}

async function latestScoreByKey(
  page: Page,
  baseUrl: string,
  gameKey: string,
): Promise<number | null> {
  const response = await page.request.get(`${baseUrl}/api/library?includeEnded=false`);
  const games = (await response.json()) as {
    key: { platform: string; externalId: string };
    latestScore: number | null;
  }[];
  return games.find((game) => `${game.key.platform}/${game.key.externalId}` === gameKey)?.latestScore ?? null;
}

test('별점 입력 → 내용 변경 1행', async ({ page }) => {
  test.setTimeout(300000);
  const server = await startPerfServer();
  try {
    await page.goto(`${server.baseUrl}/library`);
    await expect(page.locator('li[data-game-key]').first()).toBeVisible();
    const targetKey = await page.evaluate(() => {
      const first = document.querySelector('li[data-game-key]');
      return first?.getAttribute('data-game-key') ?? '';
    });
    expect(targetKey).not.toBe('');
    const slider = page.locator(`li[data-game-key="${targetKey}"] [role="slider"]`);
    await slider.focus();
    if ((await latestScoreByKey(page, server.baseUrl, targetKey)) !== null) {
      const [resetResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes('/api/ratings/') &&
            response.request().method() === 'PUT',
        ),
        page.keyboard.press('Delete'),
      ]);
      expect(resetResponse.status()).toBe(200);
      await slider.focus();
    }
    await page.evaluate(() => {
      const store = {
        changed: new Set<string>(),
        mutations: 0,
        added: 0,
      };
      (window as unknown as { __rerenderObs: unknown }).__rerenderObs = store;
      const list = document.querySelector('main[data-route="library"] ul');
      if (list === null) throw new Error('목록 없음');
      const observer = new MutationObserver((entries) => {
        store.mutations += entries.length;
        for (const entry of entries) {
          for (const node of [...entry.addedNodes]) {
            if (
              node instanceof HTMLElement &&
              node.matches('li[data-game-key]')
            ) {
              store.added += 1;
            }
          }
          const host =
            entry.target instanceof Element
              ? entry.target.closest('li[data-game-key]')
              : entry.target.parentElement?.closest('li[data-game-key]');
          const key = host?.getAttribute('data-game-key');
          if (key !== null && key !== undefined) store.changed.add(key);
        }
      });
      observer.observe(list, {
        childList: true,
        characterData: true,
        attributes: true,
        subtree: true,
      });
      (window as unknown as { __rerenderStop: unknown }).__rerenderStop = () => {
        observer.disconnect();
        return {
          changedKeys: [...store.changed],
          mutationCount: store.mutations,
          addedRows: store.added,
        };
      };
    });
    const rowHeightOf = (key: string): Promise<number> =>
      page.evaluate((k) => {
        const li = document.querySelector(`li[data-game-key="${k}"]`);
        return li instanceof HTMLElement ? li.offsetHeight : -1;
      }, key);
    const heightBefore = await rowHeightOf(targetKey);
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
    await page.waitForTimeout(500);
    // RATE3-F2: 별점 전후 대상 행 높이 동일(슬롯 예약).
    expect(await rowHeightOf(targetKey)).toBe(heightBefore);
    const observed = (await page.evaluate(
      () =>
        (
          window as unknown as {
            __rerenderStop: () => Observed;
          }
        ).__rerenderStop(),
    )) as Observed;
    console.log(
      `[rerender] changed=${JSON.stringify(observed.changedKeys)} mutations=${observed.mutationCount} addedRows=${observed.addedRows}`,
    );
    expect(observed.changedKeys).toEqual([targetKey]);
  } finally {
    await stopPerfServer(server);
  }
});
