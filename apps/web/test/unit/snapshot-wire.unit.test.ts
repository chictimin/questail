/**
 * W-cron-2 실배선 단위 — boot 게이트가 실값을 보는지 + Live no-op.
 * 실제 대기·실행 없음.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boot, type BootDeps } from '../../src/server/boot.js';
import { registerCronLive, runOverdueSnapshotLive } from '../../src/server/deps.js';
import { startServer } from '../../src/server/serve.js';

function gateDeps(calls: string[], connected: boolean): BootDeps {
  return {
    env: { QUESTAIL_DATA_DIR: join(tmpdir(), 'questail-paru-gate') },
    timeZone: 'UTC',
    backupDatabase: async () => undefined,
    migrateDatabase: async () => ({ close: async () => undefined }),
    isConnected: () => {
      calls.push('isConnected');
      return connected;
    },
    runOverdueSnapshot: async () => {
      calls.push('snapshot');
    },
    registerCron: () => {
      calls.push('registerCron');
      return { unregister: () => undefined };
    },
    listen: async (app) => {
      calls.push('listen');
      return startServer(app, 0);
    },
  };
}

describe('boot background 게이트', () => {
  it('connected true → snapshot 호출', async () => {
    const calls: string[] = [];
    const booted = await boot(gateDeps(calls, true));
    await booted.background;
    expect(calls).toContain('snapshot');
    expect(calls).toContain('registerCron');
    await booted.shutdown();
  });

  it('connected false → snapshot 미호출', async () => {
    const calls: string[] = [];
    const booted = await boot(gateDeps(calls, false));
    await booted.background;
    expect(calls).not.toContain('snapshot');
    expect(calls).toContain('registerCron');
    await booted.shutdown();
  });
});

describe('Live no-op', () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) {
      rmSync(dirs.pop() as string, { recursive: true, force: true });
    }
  });

  it('service 없음 → 호출 0', async () => {
    const service = { resyncSource: vi.fn() };
    const dir = mkdtempSync(join(tmpdir(), 'questail-paru-live-'));
    dirs.push(dir);
    await runOverdueSnapshotLive({
      signal: new AbortController().signal,
      service: undefined,
      db: undefined,
      timeZone: 'UTC',
    });
    expect(service.resyncSource).not.toHaveBeenCalled();
    const cron = registerCronLive({
      service: undefined,
      db: undefined,
      timeZone: 'UTC',
    });
    cron.unregister();
  });
});
