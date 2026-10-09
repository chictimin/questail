import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

/**
 * W-P6 [2] 연동 성공 E2E — 가짜 Steam + 실서버(pnpm start 경유) + 화면 제출.
 * 실키·실호출 0. dist 빌드는 pnpm start가 맡는다(B 방식, spec 자체 빌드 없음).
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = join(WEB, '..', '..');

test.use({ locale: 'ko-KR' });

test('가짜 Steam 검증 → 연동 성공 + steam.key 생성', async ({ page }) => {
  test.setTimeout(300000);
  const dir = mkdtempSync(join(tmpdir(), 'questail-wp6-e2e-'));
  const dataDir = join(dir, 'data');
  const steamId = '76561198000000001';

  const fake = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith('/ISteamUser/GetPlayerSummaries/v2/')) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const ids = url.searchParams.get('steamids') ?? '';
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ response: { players: [{ steamid: ids }] } }));
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  const fakePort = (fake.address() as AddressInfo).port;

  const appPort = await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });

  let child: ChildProcess | null = null;
  try {
    child = spawn('pnpm', ['--dir', ROOT, 'start'], {
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
        const response = await page.request.get(`http://127.0.0.1:${appPort}/api/health`);
        if (response.status() === 200) break;
      } catch {
        // 아직 안 뜸
      }
      if (Date.now() >= deadline) {
        throw new Error('health 200 없음(240초)');
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    await page.goto(`http://127.0.0.1:${appPort}/connect`);
    await page.getByLabel('Steam Web API 키').fill('A'.repeat(32));
    await page.getByLabel('프로필 주소 또는 SteamID').fill(steamId);
    await page.getByRole('button', { name: '연결하고 물어오기' }).click();
    await expect(page.getByText('연결했어요')).toBeVisible();
    expect(existsSync(join(dataDir, 'steam.key'))).toBe(true);
    // 언어 안내: 성공 분기에 표시 언어 기준 안내 + 설정 링크.
    await expect(
      page.getByText('표시 언어 기준으로 게임 정보를 가져와요. 먼저 언어를 확인해 주세요.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: '설정' })).toHaveAttribute(
      'href',
      '/settings',
    );
    // P7W-F1: 성공 후 셸 상태가 갱신돼 /library에 머문다(미연동 리다이렉트 없음).
    await expect(page).toHaveURL(/\/library$/);
    await expect(
      page.locator('main[data-route="library"] h1'),
    ).toContainText('라이브러리');
  } finally {
    if (child !== null && child.pid !== undefined) {
      try {
        if (process.platform === 'win32') {
          const { execFileSync } = await import('node:child_process');
          execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
        } else {
          process.kill(-child.pid, 'SIGTERM');
        }
      } catch {
        // 이미 종료
      }
    }
    await new Promise<void>((resolve) => fake.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
