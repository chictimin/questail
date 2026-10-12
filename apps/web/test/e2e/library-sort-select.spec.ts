import { expect, test, type Page } from '@playwright/test';
import { createServerApp } from '../../src/server/app.js';
import { startServer, type StartedServer } from '../../src/server/serve.js';
import { uiDistDir } from '../../src/server/static.js';
import { stopServer } from './helpers.js';

/**
 * 정렬 select + 방향 버튼 · 좁은 폭 팝오버 · 재조회 중 컨트롤 잠금.
 * API는 page.route 합성(실 Steam·DB 없음). 정적 UI만 서버가 준다.
 */
let started: StartedServer;

test.beforeAll(async () => {
  started = await startServer(createServerApp({ staticRoot: uiDistDir() }), 0);
});

test.afterAll(async () => {
  await stopServer(started);
});

function game(i: number): Record<string, unknown> {
  return {
    key: { platform: 'steam', externalId: String(1000 + i) },
    name: `Synthetic Game ${i}`,
    titleKo: `합성 게임 ${i}`,
    developerRaw: null,
    releaseDate: 1600000000 + i * 86400,
    releaseDateText: null,
    genres: ['Action'],
    coverUrl: null,
    hidden: false,
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
    latestScore: i % 3 === 0 ? (i % 10) + 1 : null,
    ratingEvents: [],
    syncRunRefs: [],
  };
}

interface Mock {
  puts: unknown[];
}

async function mount(
  page: Page,
  options: { endedDelayMs?: number; sortPerFilter?: unknown[] } = {},
): Promise<Mock> {
  const mock: Mock = { puts: [] };
  const games = Array.from({ length: 40 }, (_, i) => game(i));
  const ended = Array.from({ length: 10 }, (_, i) => ({ ...game(i), key: { platform: 'steam', externalId: `e${i}` } }));
  const prefs = {
    locale: 'ko',
    hidden: [],
    sortPerFilter: options.sortPerFilter ?? [],
    hideShortPlaytime: false,
  };
  await page.route('**/api/connect/status', (route) => route.fulfill({ json: { connected: true } }));
  await page.route('**/api/sync/status', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/library**', async (route) => {
    const includeEnded = route.request().url().includes('includeEnded=true');
    if (includeEnded && options.endedDelayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, options.endedDelayMs));
    }
    await route.fulfill({ json: includeEnded ? [...games, ...ended] : games });
  });
  await page.route('**/api/prefs**', async (route) => {
    const request = route.request();
    if (request.method() === 'PUT') {
      mock.puts.push(JSON.parse(request.postData() ?? 'null'));
    }
    await route.fulfill({ json: prefs });
  });
  await page.goto(`http://127.0.0.1:${started.port}/library`);
  await page.waitForSelector('main[data-route="library"] article');
  return mock;
}

const OPEN = 'summary.lib-filter-btn';

test.describe('정렬 select + 방향', () => {
  test.use({ locale: 'ko-KR', viewport: { width: 390, height: 844 } });

  test('초기 렌더·필터 전환은 저장값 복원, PUT 0', async ({ page }) => {
    const mock = await mount(page, {
      sortPerFilter: [
        { filterKey: 'all', sortKey: 'name', direction: 'desc' },
        { filterKey: 'unrated', sortKey: 'addedAt', direction: 'asc' },
      ],
    });
    await expect(page.locator('.result-line')).toContainText('이름 역순');
    await page.getByRole('tab', { name: '미평가만' }).click();
    await expect(page.locator('.result-line')).toContainText('라이브러리 추가일 오래된 순');
    await page.getByRole('tab', { name: '전체' }).click();
    await expect(page.locator('.result-line')).toContainText('이름 역순');
    await page.getByRole('tab', { name: '별점별' }).click();
    await expect(page.locator('.result-line')).toContainText('평가일 최근 순');
    expect(mock.puts).toEqual([]);
  });

  test('기준 전환은 기본 방향, 방향 버튼은 반대 방향 — 사용자 조작만 PUT', async ({ page }) => {
    const mock = await mount(page);
    await page.locator(OPEN).click();
    const select = page.getByRole('combobox', { name: '정렬' });
    await select.selectOption('name');
    await expect(page.locator('.result-line')).toContainText('이름순');
    await page.getByRole('button', { name: '방향 오름차순' }).click();
    await expect(page.locator('.result-line')).toContainText('이름 역순');
    await select.selectOption('addedAt');
    await expect(page.locator('.result-line')).toContainText('라이브러리 추가일 최근 순');
    await expect(page.getByRole('button', { name: '방향 내림차순' })).toBeVisible();
    expect(mock.puts).toEqual([
      { sortPerFilter: [{ filterKey: 'all', sortKey: 'name', direction: 'asc' }] },
      { sortPerFilter: [{ filterKey: 'all', sortKey: 'name', direction: 'desc' }] },
      { sortPerFilter: [{ filterKey: 'all', sortKey: 'addedAt', direction: 'desc' }] },
    ]);
  });

  test('Escape는 팝오버를 닫고 트리거로 포커스를 돌린다', async ({ page }) => {
    await mount(page);
    await page.locator(OPEN).click();
    await page.getByRole('combobox', { name: '정렬' }).focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('details.lib-filter')).not.toHaveAttribute('open', '');
    await expect(page.locator(OPEN)).toBeFocused();
  });

  test('팝오버 열림 전·중·후 window.scrollY·리스트 scrollTop 동일, 하단은 viewport 안', async ({ page }) => {
    await mount(page);
    const list = page.locator('.library-list');
    await list.hover();
    await page.mouse.wheel(0, 900);
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(900);
    const read = () =>
      page.evaluate(() => ({
        y: window.scrollY,
        top: document.querySelector('.library-list')?.scrollTop ?? -1,
      }));
    const before = await read();
    await page.locator(OPEN).dispatchEvent('click');
    await expect(page.locator('details.lib-filter')).toHaveAttribute('open', '');
    await page.mouse.move(200, 600);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(300);
    expect(await read()).toEqual(before);
    const bottom = await page.locator('.lib-popover').evaluate((el) => el.getBoundingClientRect().bottom);
    expect(bottom).toBeLessThanOrEqual(844);
    await page.keyboard.press('Escape');
    expect(await read()).toEqual(before);
  });
});

test.describe('빠진 게임 재조회 중', () => {
  test.use({ locale: 'ko-KR', viewport: { width: 390, height: 844 } });

  test('팝오버·리스트 유지, 관련 컨트롤 disabled, 응답 후 해제·scrollTop 0', async ({ page }) => {
    const mock = await mount(page, { endedDelayMs: 1200 });
    const list = page.locator('.library-list');
    await list.hover();
    await page.mouse.wheel(0, 500);
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(500);
    await page.locator(OPEN).dispatchEvent('click');
    await page.getByRole('switch', { name: '빠진 게임 포함' }).dispatchEvent('click');
    await expect(page.getByRole('combobox', { name: '정렬' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '방향 내림차순' })).toBeDisabled();
    await expect(page.getByRole('switch', { name: '30분 이하 가리기' })).toBeDisabled();
    await expect(page.locator('details.lib-filter')).toHaveAttribute('open', '');
    await expect(page.locator('.lib-skel')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: '정렬' })).toBeEnabled({ timeout: 5000 });
    await expect(page.locator('.result-line')).toContainText('50개');
    expect(await list.evaluate((el) => el.scrollTop)).toBe(0);
    expect(mock.puts).toEqual([]);
  });
});
