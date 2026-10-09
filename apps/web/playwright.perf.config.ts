import { defineConfig } from '@playwright/test';

/** W10b perf — test/perf만, 300초 상한, 워커 1. 기본 pnpm test에 포함하지 않는다. */
export default defineConfig({
  testDir: 'test/perf',
  timeout: 300_000,
  workers: 1,
  retries: 0,
  use: {
    locale: 'ko-KR',
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: 'chromium' }],
});
