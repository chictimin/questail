import { describe, expect, it, vi } from 'vitest';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
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
import type { SyncService } from '../../src/data/service.js';

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
    env: { QUESTAIL_DATA_DIR: join(tmpdir(), 'questail-nozi-boot') },
    timeZone: 'UTC',
    backupDatabase: async (dataDir: string) => {
      calls.push(`backup:${dataDir}`);
    },
    migrateDatabase: async (
      _dataDir: string,
      opts?: { backupBeforeApply?: () => Promise<void> },
    ) => {
      await opts?.backupBeforeApply?.();
      calls.push('migrate');
      return db;
    },
    createSyncService: () => ({
      recover: async () => {
        calls.push('recover');
      },
      stop: async () => {
        calls.push('syncStop');
      },
    }) as unknown as SyncService,
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
      return {
        server: {
          close: (callback: (error?: Error) => void) => {
            calls.push('server-close');
            callback();
          },
          closeIdleConnections: () => {
            calls.push('close-idle');
          },
        } as never,
        port: 0,
      };
    },
  };
}

describe('boot 순서', () => {
  it('backup → migrate → recover → listen → isConnected → snapshot → registerCron', async () => {
    const calls: string[] = [];
    const booted = await boot(stubDeps(calls));
    await booted.background;
    expect(calls).toEqual([
      `backup:${join(tmpdir(), 'questail-nozi-boot')}`,
      'migrate',
      'recover',
      'listen',
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
    let releaseSnapshot!: () => void;
    deps.runOverdueSnapshot = async () => {
      calls.push('snapshot');
      await new Promise<void>((resolve) => {
        releaseSnapshot = resolve;
      });
    };
    const booted = await boot(deps);
    const shutting = booted.shutdown();
    releaseSnapshot();
    await shutting;
    await booted.background.then(
      () => undefined,
      () => undefined,
    );
    expect(calls).toContain('snapshot');
    expect(calls).not.toContain('registerCron');
  });

  it('recover 거부 → listen 0회 + boot 거부', async () => {
    const calls: string[] = [];
    const deps = stubDeps(calls);
    deps.createSyncService = () =>
      ({
        recover: async () => {
          throw new Error('recover failed');
        },
        stop: async () => undefined,
      }) as unknown as SyncService;
    await expect(boot(deps)).rejects.toThrow('recover failed');
    expect(calls).not.toContain('listen');
  });

  it('등록 도중 abort → 늦은 cron 즉시 해제 1회', async () => {
    const calls: string[] = [];
    const deps = stubDeps(calls);
    let releaseSnapshot!: () => void;
    deps.runOverdueSnapshot = async () => {
      calls.push('snapshot');
      await new Promise<void>((resolve) => {
        releaseSnapshot = resolve;
      });
    };
    deps.registerCron = () => {
      calls.push('registerCron');
      void booted.shutdown();
      return {
        unregister: () => {
          calls.push('unregister');
        },
      };
    };
    const booted = await boot(deps);
    releaseSnapshot();
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
  it('shutdown → server-close → syncStop → unregister → close 순서', async () => {
    const calls: string[] = [];
    const booted = await boot(stubDeps(calls));
    await booted.background;
    await booted.shutdown();
    expect(calls).toContain('server-close');
    expect(calls.indexOf('server-close')).toBeLessThan(
      calls.indexOf('syncStop'),
    );
    expect(calls.indexOf('syncStop')).toBeLessThan(calls.indexOf('unregister'));
    expect(calls.indexOf('unregister')).toBeLessThan(calls.indexOf('close'));
  });

  it('shutdown → unregister + close', async () => {
    const calls: string[] = [];
    const booted = await boot(stubDeps(calls));
    await booted.background;
    await booted.shutdown();
    expect(calls).toContain('unregister');
    expect(calls).toContain('close');
  });

  it('shutdown 2회 → server-close·unregister·close 각 1회', async () => {
    const calls: string[] = [];
    const booted = await boot(stubDeps(calls));
    await booted.background;
    await booted.shutdown();
    await booted.shutdown();
    expect(calls.filter((c) => c === 'server-close')).toHaveLength(1);
    expect(calls.filter((c) => c === 'unregister')).toHaveLength(1);
    expect(calls.filter((c) => c === 'close')).toHaveLength(1);
  });

  it('shutdown 후 /api/health 새 연결이 거부된다(실제 리스너)', async () => {
    const calls: string[] = [];
    const deps = stubDeps(calls);
    deps.createApp = () => createServerApp();
    deps.listen = (app: Hono) => startServer(app, 0);
    const booted = await boot(deps);
    await booted.background;
    // 종료 전에는 200. 본문을 끝까지 읽어 소켓을 풀의 유휴 상태로 둔다.
    const before = await fetch(
      `http://127.0.0.1:${booted.port}${HEALTH_PATH}`,
    );
    expect(before.status).toBe(200);
    await before.text();
    await booted.shutdown();
    // 새 TCP 연결은 거부된다.
    await new Promise<void>((resolve, reject) => {
      const socket = connect(booted.port, '127.0.0.1');
      socket.on('connect', () => {
        socket.destroy();
        reject(new Error('shutdown 후에도 연결이 맺어짐'));
      });
      socket.on('error', (error: unknown) => {
        socket.destroy();
        if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
          resolve();
        } else {
          reject(error);
        }
      });
    });
    // 풀에 남아 있던 keep-alive 재사용 시도도 실패한다.
    await expect(
      fetch(`http://127.0.0.1:${booted.port}${HEALTH_PATH}`),
    ).rejects.toThrow();
  });

  it('응답을 붙잡힌 채 shutdown → 유예 후 강제 절단 + stderr 1줄 + DB close', async () => {
    const calls: string[] = [];
    const deps = stubDeps(calls);
    deps.shutdownGraceMs = 50;
    deps.createApp = () => {
      const app = new Hono();
      app.get('/hang', () => new Promise<Response>(() => {}));
      return app;
    };
    deps.listen = (app: Hono) => startServer(app, 0);
    const booted = await boot(deps);
    await booted.background;
    // 응답을 끝내지 않는 요청을 걸어 연결을 붙잡아 둔다.
    const hanging = fetch(`http://127.0.0.1:${booted.port}/hang`).then(
      () => 'responded' as const,
      () => 'cut' as const,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await booted.shutdown();
      expect(await hanging).toBe('cut');
      expect(calls).toContain('close');
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(errSpy.mock.calls[0]).toHaveLength(1);
      expect(String(errSpy.mock.calls[0][0])).toContain('forcing connections closed');
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe('resolveDataDir', () => {
  it('환경변수 지정 → 그 경로', () => {
    const dir = join(tmpdir(), 'questail-nozi-boot-data');
    expect(resolveDataDir({ QUESTAIL_DATA_DIR: dir })).toBe(dir);
  });

  it('상대 env → 절대 반환(표시용, 동작 위치 동일)', () => {
    const prev = process.cwd();
    try {
      process.chdir('/tmp');
      // /tmp 심링크(/private/tmp)까지 확정 — 하드코딩 금지.
      expect(resolveDataDir({ QUESTAIL_DATA_DIR: 'rel-data' })).toBe(
        resolve('rel-data'),
      );
    } finally {
      process.chdir(prev);
    }
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
