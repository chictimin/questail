import { cpus } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { startPerfServer, stopPerfServer } from './harness.js';
import { PERF_COUNT } from './seed.js';

/**
 * W10b ④ 경고 임계 기록 전용 — 실패해도 테스트 통과한다.
 * 첫 화면 ≤1초 · 필터/정렬 ≤200ms · 50ms long task 0 + 측정 환경 기록.
 * 출력: apps/web/test/fixtures/local/perf/*.json (gitignore, 커밋 안 함).
 * 판정은 QA.
 */
test.use({ locale: 'ko-KR' });

interface WarnRecord {
  measuredAt: string;
  fixtureGames: number;
  viewport: { width: number; height: number } | null;
  cpu: string;
  node: string;
  browser: string;
  firstRowMs: number;
  filterMs: number;
  sortMs: number;
  longTasksOver50ms: number;
}

async function settleRows(page: Page): Promise<void> {
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 300 && stable < 2; i++) {
    const count = await page.locator('li[data-game-key]').count();
    if (count === last) {
      stable++;
    } else {
      stable = 0;
      last = count;
    }
    await page.waitForTimeout(100);
  }
}

async function measureFilter(page: Page): Promise<number> {
  const start = Date.now();
  await page.getByRole('button', { name: '미평가만' }).first().click();
  await settleRows(page);
  return Date.now() - start;
}

async function measureSort(page: Page): Promise<number> {
  await page.getByLabel('정렬·필터').click();
  await expect(page.getByRole('radio', { name: '평가일 최근 순' })).toBeVisible();
  const start = Date.now();
  await page.getByRole('radio', { name: '평가일 최근 순' }).check();
  await settleRows(page);
  const resultLine = page.getByText('평가일 최근 순');
  await expect(resultLine.first()).toBeVisible();
  return Date.now() - start;
}

test('임계 기록 (합성 5,000건)', async ({ page, browser }) => {
  test.setTimeout(300000);
  const server = await startPerfServer();
  try {
    await page.addInitScript(() => {
      (window as unknown as { __longTasks: unknown[] }).__longTasks = [];
      try {
        const observer = new PerformanceObserver((entries) => {
          for (const entry of entries.getEntries()) {
            if (entry.duration > 50) {
              (window as unknown as { __longTasks: number[] }).__longTasks.push(entry.duration);
            }
          }
        });
        observer.observe({ entryTypes: ['longtask'] });
      } catch {
        // longtask 미지원 브라우저는 미측정 표시
      }
    });
    const start = Date.now();
    await page.goto(`${server.baseUrl}/library`);
    await expect(page.locator('li[data-game-key]').first()).toBeVisible({ timeout: 180000 });
    const firstRowMs = Date.now() - start;
    const filterMs = await measureFilter(page);
    const sortMs = await measureSort(page);
    const longTasks = await page.evaluate(
      () => (window as unknown as { __longTasks?: number[] }).__longTasks ?? null,
    );
    const record: WarnRecord = {
      measuredAt: new Date().toISOString(),
      fixtureGames: server.count,
      viewport: page.viewportSize(),
      cpu: cpus()[0]?.model ?? 'unknown',
      node: process.version,
      browser: browser.version(),
      firstRowMs,
      filterMs,
      sortMs,
      longTasksOver50ms: longTasks === null ? -1 : longTasks.length,
    };
    const outDir = join(process.cwd(), 'test', 'fixtures', 'local', 'perf');
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, `warn-${Date.now()}.json`);
    writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`[warn] ${JSON.stringify(record)}`);
    expect(PERF_COUNT).toBe(server.count);
  } finally {
    await stopPerfServer(server);
  }
});
