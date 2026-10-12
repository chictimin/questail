import { expect, test, type Page } from '@playwright/test';
import { createServerApp } from '../../src/server/app.js';
import { startServer, type StartedServer } from '../../src/server/serve.js';
import { uiDistDir } from '../../src/server/static.js';
import { stopServer } from './helpers.js';

/**
 * D4 — 빠진 게임 재조회와 행 숨기기 재조회가 겹칠 때: 컨트롤 잠금 해제 · 숨김 상태 우선 · 스켈레톤 구간 scrollTop 보존.
 * API는 page.route 합성(실 Steam·DB 없음).
 */
let started: StartedServer;

test.beforeAll(async () => {
  started = await startServer(createServerApp({ staticRoot: uiDistDir() }), 0);
});

test.afterAll(async () => {
  await stopServer(started);
});

function game(id: string, i: number, hidden: boolean): Record<string, unknown> {
  return {
    key: { platform: 'steam', externalId: id },
    name: `Synthetic Game ${id}`,
    titleKo: `합성 게임 ${id}`,
    developerRaw: null,
    releaseDate: 1600000000 + i * 86400,
    releaseDateText: null,
    genres: ['Action'],
    coverUrl: null,
    hidden,
    libraryAddedAt: 1650000000 + i * 1000,
    confirmedMinutes: 6000 - i * 40,
    lastPlayed: 1700000000 - i * 5000,
    snapshots: [],
    deltas: [],
    coverage: { firstObservedAt: null, lastObservedAt: null, gapDays: [], isBaseline: false },
    ownership: [{ origin: 'observed', startedAt: 1700000000, endedAt: null, ended: false, isBaseline: false }],
    wishlist: [],
    tags: [],
    tagStatus: 'not_collected',
    achievements: [],
    achievementState: 'not_collected',
    achievementSummary: null,
    latestScore: null,
    ratingEvents: [],
    syncRunRefs: [],
  };
}

async function mount(
  page: Page,
  options: { endedDelayMs: number; reloadDelayMs: number },
): Promise<{ hidden: Set<string> }> {
  const hidden = new Set<string>();
  const base = Array.from({ length: 40 }, (_, i) => ({ id: String(1000 + i), i }));
  const ended = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, i: 40 + i }));
  await page.route('**/api/connect/status', (route) => route.fulfill({ json: { connected: true } }));
  await page.route('**/api/sync/status', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/library**', async (route) => {
    const includeEnded = route.request().url().includes('includeEnded=true');
    // 응답 내용은 요청 시점 숨김 상태 — 지연 뒤 도착해도 그 시점 값이다.
    const rows = (includeEnded ? [...base, ...ended] : base).map((row) =>
      game(row.id, row.i, hidden.has(row.id)),
    );
    const delay = includeEnded && !hidden.size ? options.endedDelayMs : options.reloadDelayMs;
    await new Promise((resolve) => setTimeout(resolve, delay));
    await route.fulfill({ json: rows });
  });
  await page.route('**/api/prefs**', async (route) => {
    const request = route.request();
    if (request.method() === 'PUT') {
      const body = JSON.parse(request.postData() ?? 'null') as { hidden?: { externalId: string }[] };
      if (body.hidden !== undefined) {
        hidden.clear();
        for (const entry of body.hidden) hidden.add(entry.externalId);
      }
    }
    await route.fulfill({
      json: {
        locale: 'ko',
        hidden: [...hidden].map((externalId) => ({ platform: 'steam', externalId })),
        sortPerFilter: [],
        hideShortPlaytime: false,
      },
    });
  });
  await page.goto(`http://127.0.0.1:${started.port}/library`);
  await page.waitForSelector('main[data-route="library"] article');
  return { hidden };
}

const OPEN = 'summary.lib-filter-btn';

test.describe('재조회 겹침', () => {
  test.use({ locale: 'ko-KR', viewport: { width: 390, height: 844 } });

  test('빠진 게임 재조회 중 행 숨기기가 겹쳐도 컨트롤 잠금이 풀리고 숨긴 행은 되살아나지 않는다', async ({ page }) => {
    const mock = await mount(page, { endedDelayMs: 1500, reloadDelayMs: 300 });
    await page.locator(OPEN).dispatchEvent('click');
    await page.getByRole('switch', { name: '빠진 게임 포함' }).dispatchEvent('click');
    await expect(page.getByRole('combobox', { name: '정렬' })).toBeDisabled();
    // 재조회 중(응답 전)에 첫 행 숨기기.
    await page.locator('main[data-route="library"] article').first().getByRole('button', { name: '숨기기' }).dispatchEvent('click');
    await expect.poll(() => mock.hidden.size).toBe(1);
    // 두 응답이 모두 도착할 때까지 대기.
    await page.waitForTimeout(2500);
    await expect(page.locator('.lib-skel')).toHaveCount(0);
    await expect(page.locator('.result-line')).toContainText('49개');
    await page.locator(OPEN).dispatchEvent('click');
    await expect(page.getByRole('combobox', { name: '정렬' })).toBeEnabled({ timeout: 3000 });
    await expect(page.getByRole('button', { name: '방향 내림차순' })).toBeEnabled();
    await expect(page.getByRole('switch', { name: '30분 이하 가리기' })).toBeEnabled();
    await expect(page.locator('[data-game-key="steam/1000"]')).toHaveCount(0);
  });

  test.describe('넓은 폭', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('숨기기 재조회의 스켈레톤 구간을 지나도 리스트 scrollTop이 보존된다', async ({ page }) => {
      await mount(page, { endedDelayMs: 0, reloadDelayMs: 600 });
      const list = page.locator('.library-list');
      await list.hover();
      await page.mouse.wheel(0, 1500);
      await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(1500);
      const visible = page.locator('main[data-route="library"] article').nth(12);
      await visible.getByRole('button', { name: '숨기기' }).dispatchEvent('click');
      await expect(page.locator('.lib-skel')).toHaveCount(1);
      await expect(page.locator('.lib-skel')).toHaveCount(0, { timeout: 5000 });
      await expect(page.locator('.library-list')).toBeVisible();
      await page.waitForTimeout(300);
      expect(await page.locator('.library-list').evaluate((el) => el.scrollTop)).toBe(1500);
    });
  });
});
