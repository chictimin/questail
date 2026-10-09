import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '../../src/server/boot.js';

/** pnpm start 자식 프로세스 — 임시 dir·포트 → health·index 200 → 그룹 SIGTERM 정리. */
describe('pnpm start 실행', () => {
  it(
    'health 200 + / index.html 200 + 그룹 SIGTERM 후 health down·잔류 0',
    async () => {
      const dataDir = mkdtempSync(join(tmpdir(), 'w-start-'));
      const probe = createServer();
      await new Promise<void>((resolve) =>
        probe.listen(0, '127.0.0.1', resolve),
      );
      const address = probe.address();
      const port =
        address !== null && typeof address === 'object' ? address.port : 0;
      await new Promise<void>((resolve) => probe.close(() => resolve()));

      const root = findRepoRoot();
      const child: ChildProcess = spawn('pnpm', ['--dir', root, 'start'], {
        env: {
          ...process.env,
          QUESTAIL_DATA_DIR: dataDir,
          QUESTAIL_PORT: String(port),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
      let out = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        out += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        out += chunk.toString();
      });
      try {
        const healthUrl = `http://127.0.0.1:${port}/api/health`;
        let health = 0;
        for (let i = 0; i < 120; i++) {
          try {
            const response = await fetch(healthUrl);
            health = response.status;
            if (health === 200) {
              break;
            }
          } catch {
            // 기동 중 — 재시도
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        expect(health, out).toBe(200);
        const index = await fetch(`http://127.0.0.1:${port}/`);
        expect(index.status).toBe(200);
        expect(await index.text()).toContain('<div id="root">');

        // 그룹 전체(pnpm + 손자 node)에 SIGTERM — 포트 기반 kill 없음.
        // node는 wireShutdown 정리 후 exit 0, pnpm은 시그널로 죽는다.
        process.kill(-(child.pid as number), 'SIGTERM');
        const exited = await new Promise<{
          code: number | null;
          signal: string | null;
        }>((resolve) => {
          child.on('exit', (exitCode, exitSignal) =>
            resolve({ code: exitCode, signal: exitSignal }),
          );
          setTimeout(() => resolve({ code: -1, signal: null }), 30000);
        });
        expect(exited.signal, out).toBe('SIGTERM');
        // graceful 증거 — health down + 잔류 0.
        let healthDown = false;
        for (let i = 0; i < 20; i++) {
          try {
            await fetch(healthUrl);
          } catch {
            healthDown = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        expect(healthDown, out).toBe(true);
        // 그룹 전체 종료 증거 — spawn한 detached 자식의 pgid에 남은
        // 프로세스 0. 머신 전역 이름 매칭은 다른 세션·QA 클론
        // 실행을 오탐한다(START-F1)라 쓰지 않는다. 다른 그룹은
        // 읽기만 하고 종료하지 않는다.
        const pgid = child.pid as number;
        let residual: string[] = [];
        for (let i = 0; i < 10; i++) {
          let table = '';
          try {
            table = execFileSync('ps', ['-o', 'pid=,pgid='], {
              encoding: 'utf-8',
            });
          } catch {
            table = '';
          }
          residual = table
            .split('\n')
            .map((line) => line.trim().split(/\s+/))
            .filter((parts) => parts.length === 2 && Number(parts[1]) === pgid)
            .map((parts) => parts[0] as string);
          if (residual.length === 0) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        expect(residual, out).toEqual([]);
      } finally {
        try {
          process.kill(-(child.pid as number), 'SIGKILL');
        } catch {
          // 이미 종료 — 정리 불필요
        }
        rmSync(dataDir, { recursive: true, force: true });
      }
    },
    180000,
  );
});
