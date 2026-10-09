import { expect, test } from '@playwright/test';
import type { Server } from 'node:http';
import { HEALTH_PATH, createServer, listen } from '../../src/server.js';

let server: Server;
let port: number;

test.beforeAll(async () => {
  server = createServer();
  port = await listen(server);
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('browser → GET /api/health → 200', async ({ page }) => {
  const response = await page.goto(`http://127.0.0.1:${port}${HEALTH_PATH}`);
  expect(response?.status()).toBe(200);
  expect(await response?.json()).toEqual({ status: 'ok' });
});
