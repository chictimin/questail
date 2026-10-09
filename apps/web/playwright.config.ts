import { defineConfig } from '@playwright/test';

/** S6a: 번들 Chromium 1종만. 서버는 각 spec이 임시 포트로 직접 띄운다. */
export default defineConfig({
  testDir: 'test/e2e',
  timeout: 30_000,
  projects: [{ name: 'chromium' }],
});
