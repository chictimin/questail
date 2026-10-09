import { expect, test } from '@playwright/test';
import { HEALTH_PATH, createServerApp } from '../../src/server/app.js';
import { startServer, type StartedServer } from '../../src/server/serve.js';

let started: StartedServer;

test.beforeAll(async () => {
  // E2E는 임시 포트(기동 기본 4747과 무관 — 포트 충돌 방지).
  started = await startServer(createServerApp(), 0);
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    started.server.close((error: Error | undefined) =>
      error ? reject(error) : resolve(),
    );
  });
});

test('browser → 127.0.0.1 → GET /api/health → 200', async ({ page }) => {
  const response = await page.goto(
    `http://127.0.0.1:${started.port}${HEALTH_PATH}`,
  );
  expect(response?.status()).toBe(200);
  expect(await response?.json()).toEqual({ status: 'ok' });
});

test('browser → localhost → GET /api/health → 200', async ({ page }) => {
  const response = await page.goto(
    `http://localhost:${started.port}${HEALTH_PATH}`,
  );
  expect(response?.status()).toBe(200);
  expect(await response?.json()).toEqual({ status: 'ok' });
});
