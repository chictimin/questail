import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerifyFetchFn } from '../../src/data/connection.js';
import type { SyncService } from '../../src/data/service.js';
import { migrateDatabase } from '../../src/db/migrate.js';
import { acquireOwnerLock } from '../../src/db/ownerLock.js';
import { createServerApp } from '../../src/server/app.js';
import { boot, findRepoRoot, type BootDeps, type BootedServer } from '../../src/server/boot.js';
import {
  LEGACY_AND_ACCOUNT_MESSAGE,
  LEGACY_UNCONNECTED_GAMES_MESSAGE,
  resolveDataLocation,
} from '../../src/server/dataLocation.js';
import { productMigrationsFolder, productionDeps } from '../../src/server/deps.js';

/**
 * D16 반증 보완(adv D16-A·B·C) — 합성 데이터 폴더·가짜 fetch·가짜 listen만 쓴다.
 * 실 Steam·저장소 data/·4800 접촉 0. 자식 정리는 자기가 띄운 PID만.
 */
const KEY = 'abcdef0123456789abcdef0123456789';
const ID = '76561198000000001';
const OTHER_ID = '76561198000000002';
const HOST = { host: '127.0.0.1:4747', 'content-type': 'application/json' };

const tempDirs: string[] = [];
const booted: BootedServer[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
  for (const b of booted.splice(0)) {
    await b.shutdown().catch(() => undefined);
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function mkDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'questail-d16adv-'));
  tempDirs.push(dir);
  return dir;
}

// ---------- A — 제품 main 경유 자식 SIGTERM ----------
const TSX_CLI = join(findRepoRoot(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CHILD_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'helpers', 'product-main-child.ts');

function spawnMain(mode: 'clean' | 'hang', dir: string, capMs: number): ChildProcess {
  const child = spawn(process.execPath, [TSX_CLI, CHILD_SCRIPT, mode, dir, String(capMs)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  return child;
}

function waitBooted(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`BOOTED 대기 초과: ${out}`)), timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      if (out.includes('BOOTED')) {
        clearTimeout(timer);
        resolve();
      }
      if (out.includes('BOOT_FAILED')) {
        clearTimeout(timer);
        reject(new Error(out));
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`BOOTED 전 종료(exit ${code}): ${out}`));
    });
  });
}

/** SIGTERM 후 종료를 timeoutMs 안에 관측한다. 초과면 timedOut(자식은 afterEach가 SIGKILL). */
async function termAndObserve(
  child: ChildProcess,
  timeoutMs: number,
): Promise<{ timedOut: boolean; code: number | null; elapsedMs: number }> {
  const started = Date.now();
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  child.kill('SIGTERM');
  const result = await Promise.race([
    exited.then((code) => ({ timedOut: false, code })),
    new Promise<{ timedOut: true; code: null }>((resolve) =>
      setTimeout(() => resolve({ timedOut: true, code: null }), timeoutMs),
    ),
  ]);
  return { ...result, elapsedMs: Date.now() - started };
}

describe('D16-A 제품 신호 배선의 실제 프로세스 종료', () => {
  it(
    '(a) SIGTERM → 종료 코드 0 → 같은 데이터 폴더로 새 자식 기동 성공(잠금 해제)',
    async () => {
      const dir = mkDir();
      const first = spawnMain('clean', dir, 15_000);
      await waitBooted(first, 60_000);
      const seen = await termAndObserve(first, 8_000);
      expect(seen.timedOut, '자식이 SIGTERM 뒤 종료하지 않음').toBe(false);
      expect(seen.code).toBe(0);
      const second = spawnMain('clean', dir, 15_000);
      await waitBooted(second, 60_000);
      const seen2 = await termAndObserve(second, 8_000);
      expect(seen2.code).toBe(0);
    },
    120_000,
  );

  it(
    '(b) 끝나지 않는 background + SIGTERM → 상한(1.5s) 안 종료(코드 1)·잠금 재취득',
    async () => {
      const dir = mkDir();
      const hung = spawnMain('hang', dir, 1_500);
      await waitBooted(hung, 60_000);
      const seen = await termAndObserve(hung, 8_000);
      expect(seen.timedOut, '상한을 넘겨도 자식이 종료하지 않음').toBe(false);
      expect(seen.code).toBe(1);
      expect(seen.elapsedMs).toBeGreaterThanOrEqual(1_000);
      const again = spawnMain('clean', dir, 15_000);
      await waitBooted(again, 60_000);
      expect((await termAndObserve(again, 8_000)).code).toBe(0);
    },
    120_000,
  );
});

// ---------- B — 저장 완료·부착 실패 뒤 다른 ID ----------
async function bootUnattached(
  root: string,
  fetchFn: VerifyFetchFn,
  failFirstTargetOpen: boolean,
): Promise<{ request: (method: string, path: string, body?: unknown) => Promise<Response> }> {
  const real = productionDeps({}, 'UTC').migrateDatabase;
  let targetOpens = 0;
  let app: ReturnType<typeof createServerApp> | undefined;
  const deps: BootDeps = {
    ...productionDeps({}, 'UTC'),
    env: {},
    dataRoot: root,
    registerCron: () => ({ unregister: () => undefined }),
    createSyncService: () =>
      ({ recover: async () => undefined, stop: async () => undefined }) as unknown as SyncService,
    migrateDatabase: async (dir, opts) => {
      if (failFirstTargetOpen && !dir.includes('.staging-')) {
        targetOpens += 1;
        if (targetOpens === 1) {
          throw new Error('injected');
        }
      }
      return real(dir, opts);
    },
    listen: async () => ({
      server: { close: (cb: (error?: Error) => void) => cb(), closeIdleConnections: () => undefined } as never,
      port: 0,
    }),
    createApp: (ctx) => {
      app = createServerApp({
        holder: ctx.holder,
        attach: ctx.attach,
        connectDeps: { fetchFn },
        settingsDeps: { dataDir: ctx.dataDir, version: ctx.version },
      });
      return app;
    },
  };
  booted.push(await boot(deps));
  return {
    request: async (method, path, body) =>
      (app as NonNullable<typeof app>).request(path, {
        method,
        headers: HOST,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
  };
}

describe('D16-B 다른 ID 재연동 거부', () => {
  it('A 저장 완료·부착 실패 → B ID 연동은 Steam 요청 0·409 fixed_id·T_B 미생성, 같은 ID 재시도는 통과', async () => {
    const root = mkDir();
    let steamRequests = 0;
    const fetchFn: VerifyFetchFn = async (url) => {
      steamRequests += 1;
      const asked = new URL(url).searchParams.get('steamids') ?? ID;
      return { status: 200, json: async () => ({ response: { players: [{ steamid: asked }] } }) };
    };
    const h = await bootUnattached(root, fetchFn, true);
    const fail = await h.request('POST', '/api/connect', { keyText: KEY, steamId: ID });
    expect(await fail.json()).toEqual({ code: 'KEY_STORE_FAILED', params: { reason: 'attach' } });
    expect(existsSync(join(root, ID, 'questail.db'))).toBe(true);
    const beforeRequests = steamRequests;
    const entriesBefore = readdirSync(root).sort();

    const other = await h.request('POST', '/api/connect', { keyText: KEY, steamId: OTHER_ID });
    expect(other.status).toBe(409);
    expect(await other.json()).toEqual({ code: 'AUTH_ID_MISMATCH', params: { reason: 'fixed_id' } });
    expect(steamRequests).toBe(beforeRequests);
    expect(existsSync(join(root, OTHER_ID))).toBe(false);
    expect(readdirSync(root).sort()).toEqual(entriesBefore);

    const same = await h.request('POST', '/api/connect', { keyText: KEY, steamId: ID });
    expect(same.status).toBe(200);
    expect(readdirSync(root).filter((n) => /^\d{17}$/.test(n))).toEqual([ID]);
  });
});

describe('D16-B vanity 입력 경로', () => {
  it('vanity → resolve 1회만·검증 요청 0·409 fixed_id·쓰기 0', async () => {
    const root = mkDir();
    const urls: string[] = [];
    const fetchFn: VerifyFetchFn = async (url) => {
      urls.push(url);
      if (url.includes('ResolveVanityURL')) {
        return { status: 200, json: async () => ({ response: { success: 1, steamid: OTHER_ID } }) };
      }
      const asked = new URL(url).searchParams.get('steamids') ?? ID;
      return { status: 200, json: async () => ({ response: { players: [{ steamid: asked }] } }) };
    };
    const h = await bootUnattached(root, fetchFn, true);
    await h.request('POST', '/api/connect', { keyText: KEY, steamId: ID });
    urls.length = 0;
    const entries = readdirSync(root).sort();
    const res = await h.request('POST', '/api/connect', { keyText: KEY, steamId: ID, vanity: 'someone' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'AUTH_ID_MISMATCH', params: { reason: 'fixed_id' } });
    expect(urls.length).toBe(1);
    expect(urls[0]).toContain('ResolveVanityURL');
    expect(readdirSync(root).sort()).toEqual(entries);
  });
});

// ---------- C — T 잠금이 readonly 열기보다 먼저 ----------
describe('D16-C 계정 폴더 잠금 → readonly 검사 순서', () => {
  it('②-c 계정 폴더 1개: 잠금 취득이 steam_id readonly 읽기보다 먼저', async () => {
    const root = mkDir();
    const account = join(root, ID);
    mkdirSync(account, { recursive: true });
    const handle = await migrateDatabase(account, productMigrationsFolder());
    handle.db.prepare('insert into account (id, steam_id, created_at) values (1, ?, 1)').run(ID);
    await handle.close();
    const order: string[] = [];
    const location = await resolveDataLocation({}, 'QUESTAIL_DATA_DIR', {
      defaultRoot: () => root,
      acquireLock: (dir) => {
        order.push(`lock:${dir === root ? 'R' : dir.endsWith(ID) ? 'T' : dir}`);
        return acquireOwnerLock(dir);
      },
      readSteamId: (dbPath) => {
        order.push(`read:${dbPath.includes(ID) ? 'T' : dbPath}`);
        return ID;
      },
    });
    expect(location.mode).toBe('account');
    expect(order.indexOf('lock:T')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('read:T')).toBeGreaterThan(order.indexOf('lock:T'));
  });

  it('T 잠금 실패면 readonly 열기 0·기동 실패', async () => {
    const root = mkDir();
    const account = join(root, ID);
    mkdirSync(account, { recursive: true });
    const handle = await migrateDatabase(account, productMigrationsFolder());
    handle.db.prepare('insert into account (id, steam_id, created_at) values (1, ?, 1)').run(ID);
    await handle.close();
    const read = vi.fn(() => ID);
    await expect(
      resolveDataLocation({}, 'QUESTAIL_DATA_DIR', {
        defaultRoot: () => root,
        acquireLock: (dir) => {
          if (dir.endsWith(ID)) {
            throw new Error('busy');
          }
          return acquireOwnerLock(dir);
        },
        readSteamId: read,
      }),
    ).rejects.toThrow('busy');
    expect(read).not.toHaveBeenCalled();
  });
});

// ---------- D — ②-a (ii) 안내 문구 분리 ----------
describe('D 레거시 연동 0·games ≥1 안내', () => {
  it('계정 폴더 없음 → 공존 문구와 다른 전용 문구로 기동 실패(경로 원문 0)', async () => {
    const root = mkDir();
    const legacy = await migrateDatabase(root, productMigrationsFolder());
    legacy.db.prepare("insert into games (platform, external_id, name) values ('steam', '10', 'g')").run();
    await legacy.close();
    let message = '';
    try {
      await resolveDataLocation({}, 'QUESTAIL_DATA_DIR', {
        defaultRoot: () => root,
        acquireLock: (dir) => acquireOwnerLock(dir),
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe(LEGACY_UNCONNECTED_GAMES_MESSAGE);
    expect(message).not.toBe(LEGACY_AND_ACCOUNT_MESSAGE);
    expect(message).not.toContain('계정 폴더');
    expect(message).not.toContain(root);
  });
});
