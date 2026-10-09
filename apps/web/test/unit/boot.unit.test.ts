import { describe, expect, it, vi } from 'vitest';
import type { Hono } from 'hono';
import {
  boot,
  findRepoRoot,
  resolveDataDir,
  type BootDatabase,
  type BootDeps,
  type CronHandle,
} from '../../src/server/boot.js';
import { HEALTH_PATH, createServerApp } from '../../src/server/app.js';
import { startServer } from '../../src/server/serve.js';

function stubDeps(calls: string[]): BootDeps {
  const db: BootDatabase = {
    close: async () => {
      calls.push('close');
    },
  };
  const cron: CronHandle = {
    unregister: () => {
      calls.push('unregister');
    },
  };
  return {
    env: { QUESTAIL_DATA_DIR: '/tmp/w3-test' },
    backupDatabase: async (dataDir: string) => {
      calls.push(`backup:${dataDir}`);
    },
    migrateDatabase: async () => {
      calls.push('migrate');
      return db;
    },
    recoverInterruptedJobs: async () => {
      calls.push('recover');
    },
    isConnected: () => {
      calls.push('isConnected');
      return true;
    },
    runOverdueSnapshot: async () => {
      calls.push('snapshot');
    },
    registerCron: () => {
      calls.push('registerCron');
      return cron;
    },
    listen: async () => {
      calls.push('listen');
      return { server: undefined as never, port: 0 };
    },
  };
}

describe('boot 순서', () => {
  it('backup → migrate → listen → recover → isConnected → snapshot → registerCron', async () => {
    const calls: string[] = [];
    const booted = await boot(stubDeps(calls));
    await booted.background;
    expect(calls).toEqual([
      'backup:/tmp/w3-test',
      'migrate',
      'listen',
      'recover',
      'isConnected',
      'snapshot',
      'registerCron',
    ]);
    await booted.shutdown();
  });
});

describe('boot 중단', () => {
  it('백업 실패 → listen 0회 + boot 거부', async () => {
    const calls: string[] = [];
    const deps = stubDeps(calls);
    deps.backupDatabase = async () => {
      calls.push('backup');
      throw new Error('backup failed');
    };
    await expect(boot(deps)).rejects.toThrow('backup failed');
    expect(calls).not.toContain('listen');
  });

  it('마이그레이션 실패 → listen 0회 + boot 거부', async () => {
    const calls: string[] = [];
    const deps = stubDeps(calls);
    deps.migrateDatabase = async () => {
      calls.push('migrate');
      throw new Error('migrate failed');
    };
    await expect(boot(deps)).rejects.toThrow('migrate failed');
    expect(calls).not.toContain('listen');
  });
});

describe('boot 백그라운드', () => {
  it('스냅샷 throw(Steam 장애)에도 listen 완료·health 200', async () => {
    const calls: string[] = [];
    const deps = stubDeps(calls);
    deps.runOverdueSnapshot = async () => {
      calls.push('snapshot');
      throw new Error('steam down');
    };
    deps.createApp = () => createServerApp();
    deps.listen = (app: Hono) => startServer(app, 0);
    const booted = await boot(deps);
    void booted.background.catch(() => undefined); // 거부 선처리(미처리 경고 방지)
    const response = await fetch(
      `http://127.0.0.1:${booted.port}${HEALTH_PATH}`,
    );
    expect(response.status).toBe(200);
    await expect(booted.background).rejects.toThrow('steam down');
    await new Promise<void>((resolve, reject) => {
      booted.server.close((error: Error | undefined) =>
        error ? reject(error) : resolve(),
      );
    });
  });

  it('미연동이면 스냅샷 호출 0', async () => {
    const calls: string[] = [];
    const deps = stubDeps(calls);
    deps.isConnected = () => false;
    const booted = await boot(deps);
    await booted.background;
    expect(calls).not.toContain('snapshot');
    expect(calls).toContain('registerCron');
    await booted.shutdown();
  });

  it('background 도중 shutdown → 이후 단계 0 호출', async () => {

    const calls: string[] = [];
    const deps = stubDeps(calls);
    let releaseRecover!: () => void;
    deps.recoverInterruptedJobs = async () => {
      calls.push('recover');
      await new Promise<void>((resolve) => {
        releaseRecover = resolve;
      });
    };
    const booted = await boot(deps);
    const shutting = booted.shutdown();
    releaseRecover();
    await shutting;
    await booted.background.then(
      () => undefined,
      () => undefined,
    );
    expect(calls).toContain('recover');
    expect(calls).not.toContain('isConnected');
    expect(calls).not.toContain('snapshot');
    expect(calls).not.toContain('registerCron');
  });

  it('등록 도중 abort → 늦은 cron 즉시 해제 1회', async () => {
    const calls: string[] = [];
    const deps = stubDeps(calls);
    let releaseRecover!: () => void;
    deps.recoverInterruptedJobs = async () => {
      calls.push('recover');
      await new Promise<void>((resolve) => {
        releaseRecover = resolve;
      });
    };
    const booted = await boot(deps);
    deps.registerCron = () => {
      calls.push('registerCron');
      void booted.shutdown();
      return {
        unregister: () => {
          calls.push('unregister');
        },
      };
    };
    releaseRecover();
    await booted.background.then(
      () => undefined,
      () => undefined,
    );
    await booted.shutdown();
    expect(calls).toContain('registerCron');
    expect(calls.filter((c) => c === 'unregister')).toHaveLength(1);
    expect(calls).toContain('close');
  });
});

describe('boot 종료', () => {
  it('shutdown → unregister + close', async () => {
    const calls: string[] = [];
    const booted = await boot(stubDeps(calls));
    await booted.background;
    await booted.shutdown();
    expect(calls).toContain('unregister');
    expect(calls).toContain('close');
  });

  it('shutdown 2회 → unregister·close 각 1회', async () => {
    const calls: string[] = [];
    const booted = await boot(stubDeps(calls));
    await booted.background;
    await booted.shutdown();
    await booted.shutdown();
    expect(calls.filter((c) => c === 'unregister')).toHaveLength(1);
    expect(calls.filter((c) => c === 'close')).toHaveLength(1);
  });
});

describe('resolveDataDir', () => {
  it('환경변수 지정 → 그 경로', () => {
    expect(
      resolveDataDir({ QUESTAIL_DATA_DIR: '/tmp/w3-data' }),
    ).toBe('/tmp/w3-data');
  });

  it('미지정 → <루트>/data (cwd가 apps/web이어도, 루트여도)', () => {
    const root = findRepoRoot();
    const prev = process.cwd();
    try {
      process.chdir(root + '/apps/web');
      expect(resolveDataDir({})).toBe(root + '/data');
      process.chdir(root);
      expect(resolveDataDir({})).toBe(root + '/data');
    } finally {
      process.chdir(prev);
    }
  });
});

describe('main 신호 배선', () => {

  it('SIGINT 핸들러가 shutdown을 호출하고 해제가 지운다', async () => {
    const { wireShutdown } = await import('../../src/server/main.js');
    const shutdown = vi.fn(async () => undefined);
    const before = process.listeners('SIGINT').length;
    const unwire = wireShutdown(shutdown);
    expect(process.listeners('SIGINT').length).toBe(before + 1);
    const handler = process
      .listeners('SIGINT')
      .at(-1) as (...args: unknown[]) => void;
    handler();
    expect(shutdown).toHaveBeenCalledTimes(1);
    unwire();
    expect(process.listeners('SIGINT').length).toBe(before);
  });
});
