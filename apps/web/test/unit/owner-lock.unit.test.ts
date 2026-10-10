import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OWNER_LOCK_BUSY_MESSAGE,
  OWNER_LOCK_FILE_NAME,
  OWNER_LOCK_UNAVAILABLE_MESSAGE,
  acquireOwnerLock,
} from '../../src/db/ownerLock.js';
import {
  boot,
  findRepoRoot,
  type BootDatabase,
  type BootDeps,
} from '../../src/server/boot.js';

/**
 * D16-1 소유 잠금(P-12 ⑥). 현행 데이터 디렉터리 해석은 그대로 두고
 * boot이 DB 열기 전에 .owner.lock을 BEGIN EXCLUSIVE로 취득한다.
 */
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tmpDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'questail-nozi-owner-'));
  tempDirs.push(dir);
  return dir;
}

function stubBootDeps(
  calls: string[],
  acquire: BootDeps['acquireOwnerLock'],
  dataDir: string,
): BootDeps {
  const db: BootDatabase = {
    close: async () => {
      calls.push('close');
    },
  };
  return {
    env: { QUESTAIL_DATA_DIR: dataDir },
    timeZone: 'UTC',
    acquireOwnerLock: acquire,
    backupDatabase: async () => {
      calls.push('backup');
    },
    migrateDatabase: async (dir: string) => {
      calls.push(`migrate:${dir}`);
      return db;
    },
    isConnected: () => false,
    runOverdueSnapshot: async () => undefined,
    registerCron: () => ({
      unregister: () => {
        calls.push('unregister');
      },
    }),
    listen: async () => {
      calls.push('listen');
      return {
        server: {
          close: (callback: (error?: Error) => void) => {
            calls.push('server-close');
            callback();
          },
          closeIdleConnections: () => undefined,
        } as never,
        port: 0,
      };
    },
  };
}

describe('owner lock 취득', () => {
  it('같은 경로 재취득 → 기존 연결 재사용(자기 BUSY 없음)', () => {
    const dir = tmpDataDir();
    const first = acquireOwnerLock(dir);
    expect(acquireOwnerLock(dir)).toBe(first);
    expect(acquireOwnerLock(realpathSync(dir))).toBe(first);
    const pid = first.connection
      .prepare('SELECT pid FROM owner_lock')
      .get() as { pid: number };
    expect(pid).toEqual({ pid: process.pid });
  });

  it('다른 경로 → 다른 연결·다른 잠금 파일', () => {
    const first = acquireOwnerLock(tmpDataDir());
    const second = acquireOwnerLock(tmpDataDir());
    expect(second).not.toBe(first);
    expect(second.filePath).not.toBe(first.filePath);
  });

  it('잠금 파일 생성·journal delete·busy_timeout 0·WAL 부산물 없음', () => {
    const dir = tmpDataDir();
    const handle = acquireOwnerLock(dir);
    expect(existsSync(handle.filePath)).toBe(true);
    expect(handle.filePath).toBe(
      join(realpathSync(dir), OWNER_LOCK_FILE_NAME),
    );
    expect(
      handle.connection.pragma('journal_mode', { simple: true }),
    ).toBe('delete');
    expect(
      handle.connection.pragma('busy_timeout', { simple: true }),
    ).toBe(0);
    expect(existsSync(`${handle.filePath}-wal`)).toBe(false);
  });

  it('boot은 잠금을 migrate(DB 열기)보다 먼저 취득한다', async () => {
    const calls: string[] = [];
    const dir = tmpDataDir();
    const booted = await boot(
      stubBootDeps(
        calls,
        (lockDir: string) => {
          calls.push(`lock:${lockDir}`);
          return acquireOwnerLock(lockDir);
        },
        dir,
      ),
    );
    await booted.background;
    await booted.shutdown();
    expect(calls[0]).toBe(`lock:${dir}`);
    expect(calls[1]).toBe(`migrate:${dir}`);
  });

  it('BUSY → 기동 실패 안내 + 값·경로 원문 없음 + migrate·listen 0회', async () => {
    const calls: string[] = [];
    const dir = tmpDataDir();
    const busy = new Error('database is locked');
    (busy as { code?: string }).code = 'SQLITE_BUSY';
    await expect(
      boot(
        stubBootDeps(calls, () => {
          throw busy;
        }, dir),
      ),
    ).rejects.toThrow(OWNER_LOCK_BUSY_MESSAGE);
    try {
      await boot(
        stubBootDeps(calls, () => {
          throw busy;
        }, dir),
      );
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toBe(OWNER_LOCK_BUSY_MESSAGE);
      expect(message).not.toContain(dir);
    }
    expect(calls).not.toContain('backup');
    expect(calls.find((c) => c.startsWith('migrate:'))).toBeUndefined();
    expect(calls).not.toContain('listen');
  });

  it('BUSY 외 취득 실패 → 별도 안내(값·경로 원문 없음)', async () => {
    const calls: string[] = [];
    const dir = tmpDataDir();
    try {
      await boot(
        stubBootDeps(calls, () => {
          throw new Error('EACCES');
        }, dir),
      );
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toBe(OWNER_LOCK_UNAVAILABLE_MESSAGE);
      expect(message).not.toContain(dir);
      expect(message).not.toContain('EACCES');
    }
    expect(calls).not.toContain('listen');
  });
});

const TSX_CLI = join(findRepoRoot(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CHILD_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  'helpers',
  'owner-lock-child.ts',
);

function spawnChild(mode: string, dir: string): ChildProcess {
  return spawn(process.execPath, [TSX_CLI, CHILD_SCRIPT, mode, dir], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function waitForLine(
  child: ChildProcess,
  line: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`자식 출력 대기 초과: ${line} (받은 출력: ${out})`));
    }, timeoutMs);
    const onData = (chunk: Buffer): void => {
      out += chunk.toString();
      if (out.includes(line)) {
        cleanup();
        resolve(out);
      }
    };
    const onExit = (code: number | null): void => {
      cleanup();
      reject(
        new Error(`자식이 ${line} 전에 종료(exit ${code}): ${out}`),
      );
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.off('exit', onExit);
    };
    child.stdout?.on('data', onData);
    child.on('exit', onExit);
  });
}

function runToExit(child: ChildProcess): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  const exited = await Promise.race([
    runToExit(child).then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10000)),
  ]);
  if (!exited) {
    child.kill('SIGKILL');
    await runToExit(child);
  }
}

describe('owner lock 자식 프로세스', () => {
  it(
    '같은 폴더 두 번째 기동 실패 → 첫 종료 후 재기동 성공',
    async () => {
      const dir = tmpDataDir();
      const holder = spawnChild('boot-holder', dir);
      try {
        await waitForLine(holder, 'BOOTED', 60000);
        const second = await runToExit(spawnChild('boot-tryer', dir));
        expect(second.code).toBe(5);
        expect(second.stdout).toContain(
          `BOOT_FAILED:${OWNER_LOCK_BUSY_MESSAGE}`,
        );
        expect(second.stdout).not.toContain(dir);
      } finally {
        await stopChild(holder);
      }
      const third = await runToExit(spawnChild('boot-tryer', dir));
      expect(
        `${third.stdout}\n${third.stderr}`,
        `exit ${third.code}`,
      ).toContain('BOOTED');
      expect(third.code).toBe(0);
    },
    120000,
  );
});
