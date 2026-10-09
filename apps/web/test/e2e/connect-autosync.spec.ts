import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

/**
 * AUTO-SYNC E2E — 연동 성공 직후 POST /api/sync 1회.
 * 가짜 Steam(루프백) + 실서버(pnpm start 경유) + 화면 제출, 실키·실Steam 호출 0.
 * 빈 라이브러리라 수집 타깃 0건. owned는 루프백 가짜 서버까지 fetch해 404로 실패한다.
 * 실 Steam 0은 루프백 baseUrl 덕분이다.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = join(WEB, '..', '..');

test.use({ locale: 'ko-KR' });

interface StartedApp {
  child: ChildProcess;
  fake: ReturnType<typeof createServer>;
  dir: string;
  dataDir: string;
  port: number;
}

async function freePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

async function startApp(): Promise<StartedApp> {
  const dir = mkdtempSync(join(tmpdir(), 'questail-autosync-e2e-'));
  const dataDir = join(dir, 'data');
  const steamId = '76561198000000001';
  const fake = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname.startsWith('/ISteamUser/GetPlayerSummaries/v2/')) {
      const ids = url.searchParams.get('steamids') ?? '';
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ response: { players: [{ steamid: ids }] } }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  const fakePort = (fake.address() as AddressInfo).port;
  const appPort = await freePort();
  const child = spawn('pnpm', ['--dir', ROOT, 'start'], {
    env: {
      ...process.env,
      QUESTAIL_STEAM_API_BASE: `http://127.0.0.1:${fakePort}`,
      QUESTAIL_PORT: String(appPort),
      QUESTAIL_DATA_DIR: dataDir,
    },
    detached: process.platform !== 'win32',
    stdio: 'ignore',
  });
  const deadline = Date.now() + 240000;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${appPort}/api/health`);
      if (response.status === 200) break;
    } catch {
      // 아직 안 뜸
    }
    if (Date.now() >= deadline) {
      throw new Error('health 200 없음(240초)');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { child, fake, dir, dataDir, port: appPort };
}

async function stopApp(app: StartedApp): Promise<void> {
  if (app.child.pid !== undefined) {
    try {
      if (process.platform === 'win32') {
        const { execFileSync } = await import('node:child_process');
        execFileSync('taskkill', ['/PID', String(app.child.pid), '/T', '/F']);
      } else {
        process.kill(-app.child.pid, 'SIGTERM');
      }
    } catch {
      // 이미 종료
    }
  }
  await new Promise<void>((resolve) => app.fake.close(() => resolve()));
  rmSync(app.dir, { recursive: true, force: true });
}

async function submitConnect(page: Page, port: number): Promise<void> {
  await page.goto(`http://127.0.0.1:${port}/connect`);
  await page.getByLabel('Steam Web API 키').fill('A'.repeat(32));
  await page.getByLabel('프로필 주소 또는 SteamID').fill('76561198000000001');
  await page.getByRole('button', { name: '연결하고 물어오기' }).click();
  await expect(page.getByText('연결했어요')).toBeVisible();
}

async function waitRunId(port: number): Promise<void> {
  const deadline = Date.now() + 30000;
  for (;;) {
    const response = await fetch(`http://127.0.0.1:${port}/api/sync/status`);
    const entries = (await response.json()) as { runId: number | null }[];
    if (entries.some((entry) => entry.runId !== null)) return;
    if (Date.now() >= deadline) {
      throw new Error('runId 없음(30초) — 자동 수집 미발생');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

test('연동 성공 → 자동 수집 runId + /library 이동', async ({ page }) => {
  test.setTimeout(300000);
  const app = await startApp();
  try {
    await submitConnect(page, app.port);
    await waitRunId(app.port);
    expect(existsSync(join(app.dataDir, 'steam.key'))).toBe(true);
    await expect(page).toHaveURL(/\/library$/);
  } finally {
    await stopApp(app);
  }
});

test('수집 실패해도 /library 이동 (sync abort)', async ({ page }) => {
  test.setTimeout(300000);
  const app = await startApp();
  try {
    await page.route('**/api/sync', (route) => route.abort());
    await submitConnect(page, app.port);
    await expect(page).toHaveURL(/\/library$/);
  } finally {
    await stopApp(app);
  }
});
