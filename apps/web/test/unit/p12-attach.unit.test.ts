import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerifyFetchFn } from '../../src/data/connection.js';
import type { SyncService } from '../../src/data/service.js';
import { migrateDatabase } from '../../src/db/migrate.js';
import { createServerApp } from '../../src/server/app.js';
import { boot, type BootDeps, type BootedServer } from '../../src/server/boot.js';
import { productMigrationsFolder, productionDeps } from '../../src/server/deps.js';

/**
 * 계약 P-12 D16-3 — 해석 ②~⑦·연동 전 API·부착(3N·3E)·동시성·종료 경계.
 * 합성 루트 R(임시 디렉터리)·가짜 fetch·가짜 listen만 쓴다. 실 Steam·저장소 data/ 접촉 0.
 */
const HOST = { host: '127.0.0.1:4747' };
const JSON_HEADERS = { ...HOST, 'content-type': 'application/json' };
const KEY = 'abcdef0123456789abcdef0123456789';
const ID = '76561198000000001';
const OTHER_ID = '76561198000000002';

const tempDirs: string[] = [];
const booted: BootedServer[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const b of booted.splice(0)) {
    await b.shutdown().catch(() => undefined);
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function mkRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'questail-p12-'));
  tempDirs.push(dir);
  return dir;
}

async function seedDb(
  dir: string,
  opts: { steamId?: string | null; game?: boolean; prefs?: Record<string, string> } = {},
): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const handle = await migrateDatabase(dir, productMigrationsFolder());
  const db = handle.db;
  if (opts.steamId !== undefined && opts.steamId !== null) {
    db.prepare('insert into account (id, steam_id, created_at) values (1, ?, 1)').run(opts.steamId);
  }
  if (opts.game === true) {
    db.prepare("insert into games (platform, external_id, name) values ('steam', '10', 'g')").run();
  }
  for (const [key, value] of Object.entries(opts.prefs ?? {})) {
    db.prepare('insert into preferences (key, value, updated_at) values (?, ?, 1)').run(key, value);
  }
  await handle.close();
}

function readPref(dir: string, key: string): string | null {
  const db = new Database(join(dir, 'questail.db'), { readonly: true });
  try {
    const row = db.prepare('select value from preferences where key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  } finally {
    db.close();
  }
}

function accountId(dir: string): string | null {
  const db = new Database(join(dir, 'questail.db'), { readonly: true });
  try {
    const row = db.prepare('select steam_id as s from account').get() as { s: string } | undefined;
    return row?.s ?? null;
  } finally {
    db.close();
  }
}

function okFetchFor(steamId: string): VerifyFetchFn {
  return async () => ({
    status: 200,
    json: async () => ({ response: { players: [{ steamid: steamId }] } }),
  });
}

function gatedFetch(steamId: string): { fn: VerifyFetchFn; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fn: VerifyFetchFn = async (_url, init) => {
    await Promise.race([
      gate,
      new Promise<never>((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    ]);
    return {
      status: 200,
      json: async () => ({ response: { players: [{ steamid: steamId }] } }),
    };
  };
  return { fn, release };
}

type Harness = {
  booted: BootedServer;
  request: (method: string, path: string, body?: unknown) => Promise<Response>;
  calls: string[];
  cronUnregister: ReturnType<typeof vi.fn>;
  state: { fetch: VerifyFetchFn };
};

type HarnessOpts = {
  fetch?: VerifyFetchFn;
  over?: Partial<BootDeps>;
  recover?: () => Promise<void>;
  onService?: () => void;
};

async function bootAt(root: string, opts: HarnessOpts = {}): Promise<Harness> {
  const calls: string[] = [];
  const cronUnregister = vi.fn();
  const state = { fetch: opts.fetch ?? okFetchFor(ID) };
  const base = productionDeps({}, 'UTC');
  let app: ReturnType<typeof createServerApp> | undefined;
  const deps: BootDeps = {
    ...base,
    env: {},
    dataRoot: root,
    registerCron: () => {
      calls.push('cron');
      return { unregister: cronUnregister };
    },
    createSyncService: () => {
      opts.onService?.();
      return {
        recover: async () => {
          calls.push('recover');
          await opts.recover?.();
        },
        stop: async () => {
          calls.push('stop');
        },
      } as unknown as SyncService;
    },
    listen: async () => ({
      server: {
        close: (cb: (error?: Error) => void) => cb(),
        closeIdleConnections: () => undefined,
      } as never,
      port: 0,
    }),
    createApp: (ctx) => {
      const layer = ctx.holder?.get();
      app = createServerApp({
        holder: ctx.holder,
        attach: ctx.attach,
        connectDeps: {
          ...(layer === undefined ? {} : { db: layer.db, keyPath: layer.keyPath }),
          fetchFn: (url, init) => state.fetch(url, init),
        },
        settingsDeps: { dataDir: ctx.dataDir, version: ctx.version },
        syncService: layer?.syncService,
      });
      return app;
    },
    ...opts.over,
  };
  const b = await boot(deps);
  booted.push(b);
  return {
    booted: b,
    calls,
    cronUnregister,
    state,
    request: async (method, path, body) =>
      (app as NonNullable<typeof app>).request(path, {
        method,
        headers: JSON_HEADERS,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
  };
}

const connectBody = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  keyText: KEY,
  steamId: ID,
  ...extra,
});

describe('P-12 ② 해석', () => {
  it('②-a 연동 레거시 + 계정 폴더 → 기동 실패', async () => {
    const root = mkRoot();
    await seedDb(root, { steamId: ID });
    await seedDb(join(root, OTHER_ID), { steamId: OTHER_ID });
    await expect(bootAt(root)).rejects.toThrow('legacy');
  });

  it('②-a 연동 0·games ≥1 → 기동 실패', async () => {
    const root = mkRoot();
    await seedDb(root, { game: true });
    await expect(bootAt(root)).rejects.toThrow('legacy');
  });

  it('②-a 빈 레거시 → 무시·경고 1줄·미부착으로 진행', async () => {
    const root = mkRoot();
    await seedDb(root, {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = await bootAt(root);
    expect(warn).toHaveBeenCalledTimes(1);
    const status = await h.request('GET', '/api/connect/status');
    expect(await status.json()).toMatchObject({ connected: false, steamId: null });
    expect(existsSync(join(root, 'questail.db'))).toBe(true);
  });

  it('②-a 손상 레거시 → 기동 실패', async () => {
    const root = mkRoot();
    writeFileSync(join(root, 'questail.db'), 'not a sqlite file at all');
    await expect(bootAt(root)).rejects.toThrow('cannot read');
  });

  it('②-b 연동된 레거시만 → R 그대로 부착', async () => {
    const root = mkRoot();
    await seedDb(root, { steamId: ID });
    const h = await bootAt(root);
    expect((await h.request('GET', '/api/library')).status).toBe(200);
    const info = (await (await h.request('GET', '/api/settings/info')).json()) as { dataDir: string };
    expect(info.dataDir).toBe(root);
  });

  it('②-c 계정 폴더 1개 → 그 폴더 부착, 점 시작·형식 불일치 이름은 무시', async () => {
    const root = mkRoot();
    await seedDb(join(root, ID), { steamId: ID });
    await seedDb(join(root, '.hidden00000000001'), { steamId: OTHER_ID });
    mkdirSync(join(root, 'notanid'));
    const h = await bootAt(root);
    const info = (await (await h.request('GET', '/api/settings/info')).json()) as { dataDir: string };
    expect(info.dataDir).toBe(join(root, ID));
  });

  it('②-d 계정 폴더 2개 이상 → 기동 실패', async () => {
    const root = mkRoot();
    await seedDb(join(root, ID), { steamId: ID });
    await seedDb(join(root, OTHER_ID), { steamId: OTHER_ID });
    await expect(bootAt(root)).rejects.toThrow('QUESTAIL_DATA_DIR');
  });

  it('③ 폴더 이름과 DB 계정 ID 불일치·NULL → 기동 실패', async () => {
    const root = mkRoot();
    await seedDb(join(root, ID), { steamId: OTHER_ID });
    await expect(bootAt(root)).rejects.toThrow('account ID');
    const root2 = mkRoot();
    await seedDb(join(root2, ID), {});
    await expect(bootAt(root2)).rejects.toThrow('account ID');
  });

  it('⑤⑦ 자기 pid 아닌 스테이징·키 임시 파일만 삭제', async () => {
    const root = mkRoot();
    const mine = `.staging-${ID}-${process.pid}-aaaa`;
    const dead = `.staging-${ID}-1999999-bbbb`;
    const odd = '.staging-weird';
    for (const name of [mine, dead, odd]) {
      mkdirSync(join(root, name));
    }
    const h = await bootAt(root);
    expect(existsSync(join(root, mine))).toBe(true);
    expect(existsSync(join(root, dead))).toBe(false);
    expect(existsSync(join(root, odd))).toBe(true);
    void h;
    const root2 = mkRoot();
    await seedDb(join(root2, ID), { steamId: ID });
    writeFileSync(join(root2, ID, 'steam.key.1999999.tmp'), 'x');
    writeFileSync(join(root2, ID, `steam.key.${process.pid}.tmp`), 'x');
    await bootAt(root2);
    expect(existsSync(join(root2, ID, 'steam.key.1999999.tmp'))).toBe(false);
    expect(existsSync(join(root2, ID, `steam.key.${process.pid}.tmp`))).toBe(true);
  });
});

describe('P-12 연동 전 API', () => {
  it('상태·prefs·업적 설정은 메모리 대기 값, 데이터 API는 409 NOT_CONNECTED', async () => {
    const root = mkRoot();
    const h = await bootAt(root);
    const status = await h.request('GET', '/api/connect/status');
    expect(await status.json()).toMatchObject({ connected: false, steamId: null });
    const prefs = await h.request('GET', '/api/prefs?fallback=ko');
    expect(await prefs.json()).toEqual({
      locale: 'ko',
      hidden: [],
      sortPerFilter: [],
      hideShortPlaytime: false,
      tbtiWishlist: true,
    });
    const put = await h.request('PUT', '/api/prefs?fallback=ko', {
      locale: 'en',
      hideShortPlaytime: true,
      sortPerFilter: [{ filterKey: 'all', sortKey: 'name', direction: 'desc' }],
    });
    expect(await put.json()).toEqual({
      locale: 'en',
      hidden: [],
      sortPerFilter: [{ filterKey: 'all', sortKey: 'name', direction: 'desc' }],
      hideShortPlaytime: true,
      tbtiWishlist: true,
    });
    const bad = await h.request('PUT', '/api/prefs?fallback=ko', {
      hidden: [{ platform: 'steam', externalId: '1' }],
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ code: 'INVALID_BODY', params: { reason: 'hidden' } });
    expect(await (await h.request('GET', '/api/settings/achievements')).json()).toEqual({ enabled: false });
    await h.request('PUT', '/api/settings/achievements', { enabled: true });
    expect(await (await h.request('GET', '/api/settings/achievements')).json()).toEqual({ enabled: true });
    const info = (await (await h.request('GET', '/api/settings/info')).json()) as { dataDir: string };
    expect(info.dataDir).toBe(root);
    expect(await (await h.request('GET', '/api/settings/backups')).json()).toEqual({ backups: [] });
    for (const [method, path, body] of [
      ['GET', '/api/library'],
      ['POST', '/api/sync', { locale: 'ko' }],
      ['GET', '/api/sync/status'],
      ['POST', '/api/sync/owned/retry', { locale: 'ko' }],
      ['PUT', '/api/ratings/steam/1', { score: 5 }],
      ['POST', '/api/export', { locale: 'ko' }],
    ] as const) {
      const res = await h.request(method, path, body);
      expect([method, path, res.status]).toEqual([method, path, 409]);
      expect(await res.json()).toEqual({ code: 'NOT_CONNECTED', params: {} });
    }
  });
});

describe('P-12 부착 3N', () => {
  it('성공: T 생성·대기 값 반영·공개 후 recover → cron·스테이징 잔여 0', async () => {
    const root = mkRoot();
    const h = await bootAt(root);
    await h.request('PUT', '/api/prefs?fallback=ko', { locale: 'en' });
    await h.request('PUT', '/api/settings/achievements', { enabled: true });
    const res = await h.request('POST', '/api/connect', connectBody());
    expect(res.status).toBe(200);
    const target = join(root, ID);
    expect(accountId(target)).toBe(ID);
    expect(readPref(target, 'locale')).toBe('en');
    expect(readPref(target, 'achievement_enabled')).toBe('1');
    expect(readFileSync(join(target, 'steam.key'), 'utf8')).toBe(KEY);
    expect(readdirSync(root).filter((n) => n.startsWith('.staging-'))).toEqual([]);
    expect((await h.request('GET', '/api/library')).status).toBe(200);
    expect(await (await h.request('GET', '/api/connect/status')).json()).toMatchObject({
      connected: true,
      steamId: ID,
    });
    const info = (await (await h.request('GET', '/api/settings/info')).json()) as { dataDir: string };
    expect(info.dataDir).toBe(target);
    await h.booted.shutdown();
    expect(h.calls).toEqual(['recover', 'cron', 'stop']);
  });

  it('body achievementsEnabled가 대기 값보다 우선', async () => {
    const root = mkRoot();
    const h = await bootAt(root);
    await h.request('PUT', '/api/settings/achievements', { enabled: true });
    const res = await h.request('POST', '/api/connect', connectBody({ achievementsEnabled: false }));
    expect(res.status).toBe(200);
    expect(readPref(join(root, ID), 'achievement_enabled')).toBe('0');
  });

  it('공개 전 실패(스테이징 마이그레이션) → T 미생성·스테이징 삭제·reason=io', async () => {
    const root = mkRoot();
    const real = productionDeps({}, 'UTC').migrateDatabase;
    const h = await bootAt(root, {
      over: {
        migrateDatabase: async (dir, opts) => {
          if (dir.includes('.staging-')) {
            throw new Error('injected');
          }
          return real(dir, opts);
        },
      },
    });
    const res = await h.request('POST', '/api/connect', connectBody());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: 'KEY_STORE_FAILED', params: { reason: 'io' } });
    expect(existsSync(join(root, ID))).toBe(false);
    expect(readdirSync(root).filter((n) => n.startsWith('.staging-'))).toEqual([]);
    expect(await (await h.request('GET', '/api/connect/status')).json()).toMatchObject({ connected: false });
  });

  it('rename 후 4 실패 → reason=attach·T 완성 폴더·미부착 유지, 다음 connect는 3E로 이어짐', async () => {
    const root = mkRoot();
    const real = productionDeps({}, 'UTC').migrateDatabase;
    let targetOpens = 0;
    const h = await bootAt(root, {
      over: {
        migrateDatabase: async (dir, opts) => {
          if (!dir.includes('.staging-')) {
            targetOpens += 1;
            if (targetOpens === 1) {
              throw new Error('injected');
            }
          }
          return real(dir, opts);
        },
      },
    });
    const res = await h.request('POST', '/api/connect', connectBody());
    expect(await res.json()).toEqual({ code: 'KEY_STORE_FAILED', params: { reason: 'attach' } });
    const target = join(root, ID);
    expect(accountId(target)).toBe(ID);
    expect(readFileSync(join(target, 'steam.key'), 'utf8')).toBe(KEY);
    expect(await (await h.request('GET', '/api/connect/status')).json()).toMatchObject({ connected: false });
    expect(h.calls).not.toContain('recover');
    const again = await h.request('POST', '/api/connect', connectBody());
    expect(again.status).toBe(200);
    expect(existsSync(join(target, 'backups'))).toBe(true);
    expect((await h.request('GET', '/api/library')).status).toBe(200);
  });
});

describe('P-12 부착 3E', () => {
  it('폴더 판정: steam_id 다름·db 없음 → dir_conflict, T 무변경', async () => {
    const root = mkRoot();
    const h = await bootAt(root);
    await seedDb(join(root, ID), { steamId: OTHER_ID });
    const res = await h.request('POST', '/api/connect', connectBody());
    expect(await res.json()).toEqual({ code: 'KEY_STORE_FAILED', params: { reason: 'dir_conflict' } });
    expect(accountId(join(root, ID))).toBe(OTHER_ID);
    mkdirSync(join(root, OTHER_ID));
    h.state.fetch = okFetchFor(OTHER_ID);
    const res2 = await h.request('POST', '/api/connect', connectBody({ steamId: OTHER_ID }));
    expect(await res2.json()).toEqual({ code: 'KEY_STORE_FAILED', params: { reason: 'dir_conflict' } });
  });

  it('성공: 백업 후 키·옵션 기록, 대기 값 > 기존 DB 값, 대기 없는 키는 불변', async () => {
    const root = mkRoot();
    const h = await bootAt(root);
    const target = join(root, ID);
    await seedDb(target, {
      steamId: ID,
      prefs: { locale: 'ko', hide_short_playtime: '1', achievement_enabled: '0' },
    });
    await h.request('PUT', '/api/prefs?fallback=ko', { locale: 'en' });
    const res = await h.request('POST', '/api/connect', connectBody());
    expect(res.status).toBe(200);
    expect(readPref(target, 'locale')).toBe('en');
    expect(readPref(target, 'hide_short_playtime')).toBe('1');
    expect(readPref(target, 'achievement_enabled')).toBe('0');
    expect(readdirSync(join(target, 'backups')).length).toBeGreaterThan(0);
  });

  it('(a) 백업 실패 → io·쓰기 0', async () => {
    const root = mkRoot();
    const h = await bootAt(root, {
      over: {
        backupDatabase: async () => {
          throw new Error('injected');
        },
      },
    });
    const target = join(root, ID);
    await seedDb(target, { steamId: ID, prefs: { locale: 'ko' } });
    const res = await h.request('POST', '/api/connect', connectBody());
    expect(await res.json()).toEqual({ code: 'KEY_STORE_FAILED', params: { reason: 'io' } });
    expect(existsSync(join(target, 'steam.key'))).toBe(false);
    expect(await (await h.request('GET', '/api/connect/status')).json()).toMatchObject({ connected: false });
  });

  it('(b) 마이그레이션 실패 → io·백업은 남음·키 0', async () => {
    const root = mkRoot();
    const real = productionDeps({}, 'UTC').migrateDatabase;
    const h = await bootAt(root, {
      over: {
        migrateDatabase: async (dir, opts) => {
          if (!dir.includes('.staging-') && dir.endsWith(ID)) {
            throw new Error('injected');
          }
          return real(dir, opts);
        },
      },
    });
    const target = join(root, ID);
    await seedDb(target, { steamId: ID });
    const res = await h.request('POST', '/api/connect', connectBody());
    expect(await res.json()).toEqual({ code: 'KEY_STORE_FAILED', params: { reason: 'io' } });
    expect(readdirSync(join(target, 'backups')).length).toBe(1);
    expect(existsSync(join(target, 'steam.key'))).toBe(false);
  });

  it('(c) 키 교체 rename 실패 → io·계정·옵션·대기 값 반영 전 그대로', async () => {
    const root = mkRoot();
    const h = await bootAt(root);
    const target = join(root, ID);
    await seedDb(target, { steamId: ID, prefs: { locale: 'ko', achievement_enabled: '0' } });
    // 키 경로가 디렉터리면 임시 파일 rename이 실패한다.
    mkdirSync(join(target, 'steam.key'));
    await h.request('PUT', '/api/prefs?fallback=ko', { locale: 'en' });
    const res = await h.request('POST', '/api/connect', connectBody({ achievementsEnabled: true }));
    expect(await res.json()).toEqual({ code: 'KEY_STORE_FAILED', params: { reason: 'io' } });
    expect(readPref(target, 'achievement_enabled')).toBe('0');
    expect(readPref(target, 'locale')).toBe('ko');
    expect(readdirSync(target).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    expect(await (await h.request('GET', '/api/connect/status')).json()).toMatchObject({ connected: false });
  });
});

describe('P-12 동시성·종료', () => {
  it('부착 중 PUT은 잠금 해제까지 대기 → 공개됐으면 부착 계층 DB에 반영', async () => {
    const root = mkRoot();
    const gate = gatedFetch(ID);
    const h = await bootAt(root, { fetch: gate.fn });
    const connecting = h.request('POST', '/api/connect', connectBody());
    await new Promise((r) => setTimeout(r, 20));
    let settled = false;
    const put = h.request('PUT', '/api/prefs?fallback=ko', { locale: 'en' }).then((res) => {
      settled = true;
      return res;
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);
    gate.release();
    expect((await connecting).status).toBe(200);
    const res = await put;
    expect(res.status).toBe(200);
    expect(readPref(join(root, ID), 'locale')).toBe('en');
  });

  it('대기 30초 초과(시간 주입) → 409 CONNECT_IN_PROGRESS·쓰기 0', async () => {
    const root = mkRoot();
    const gate = gatedFetch(ID);
    const h = await bootAt(root, { fetch: gate.fn, over: { connectWaitMs: 40 } });
    const connecting = h.request('POST', '/api/connect', connectBody());
    await new Promise((r) => setTimeout(r, 20));
    const put = await h.request('PUT', '/api/prefs?fallback=ko', { locale: 'en' });
    expect(put.status).toBe(409);
    expect(await put.json()).toEqual({ code: 'CONNECT_IN_PROGRESS', params: {} });
    const putAch = await h.request('PUT', '/api/settings/achievements', { enabled: true });
    expect(putAch.status).toBe(409);
    gate.release();
    expect((await connecting).status).toBe(200);
    expect(readPref(join(root, ID), 'locale')).toBeNull();
    expect(readPref(join(root, ID), 'achievement_enabled')).toBeNull();
  });

  it('종료 플래그가 5 직전에 서면 공개 0·reason=shutdown·T는 완성 폴더로 남음', async () => {
    const root = mkRoot();
    let shutdownP: Promise<void> | undefined;
    let holderRef: Harness | undefined;
    const h = await bootAt(root, {
      onService: () => {
        // 4(서비스 객체 생성) 중 종료 시작 → 5에서 플래그 확인.
        shutdownP = holderRef?.booted.shutdown();
      },
    });
    holderRef = h;
    const res = await h.request('POST', '/api/connect', connectBody());
    expect(await res.json()).toEqual({ code: 'KEY_STORE_FAILED', params: { reason: 'shutdown' } });
    await shutdownP;
    expect(accountId(join(root, ID))).toBe(ID);
    expect(h.calls).toEqual([]);
  });

  it('진행 중 Steam 요청은 종료 abort로 끊기고 T 미생성', async () => {
    const root = mkRoot();
    const gate = gatedFetch(ID);
    const h = await bootAt(root, { fetch: gate.fn });
    const connecting = h.request('POST', '/api/connect', connectBody());
    await new Promise((r) => setTimeout(r, 20));
    const down = h.booted.shutdown();
    const res = await connecting;
    expect(res.status).toBeGreaterThanOrEqual(400);
    await down;
    expect(existsSync(join(root, ID))).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it('시작(6) 중 종료 → 늦게 등록된 cron 즉시 해제·잔존 0', async () => {
    const root = mkRoot();
    let releaseRecover!: () => void;
    const recoverGate = new Promise<void>((resolve) => {
      releaseRecover = resolve;
    });
    const h = await bootAt(root, { recover: () => recoverGate });
    const res = await h.request('POST', '/api/connect', connectBody());
    expect(res.status).toBe(200);
    const down = h.booted.shutdown();
    await new Promise((r) => setTimeout(r, 20));
    releaseRecover();
    await down;
    // 종료 뒤에는 등록된 cron이 남지 않는다(등록 생략 또는 등록 즉시 해제).
    expect(h.cronUnregister).toHaveBeenCalledTimes(h.calls.filter((c) => c === 'cron').length);
  });
});

/**
 * D16-3 보완 — 종료 플래그 경계·4 실패·메모리 대기 값·drain 상한·잠금 재사용·①·steamId 형식·시작 6 로그.
 * 기존 it는 건드리지 않고 아래에 신규만 둔다. 실 Steam 0 — 전부 주입 fetch.
 */
type Lazy = { h?: Harness };
const stopNow = (lazy: Lazy): void => {
  void lazy.h?.booted.shutdown();
};
const nonAbortableGate = (steamId: string): { fn: VerifyFetchFn; release: () => void } => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    fn: async () => {
      await gate;
      return { status: 200, json: async () => ({ response: { players: [{ steamid: steamId }] } }) };
    },
    release,
  };
};
const stagingLeft = (root: string): string[] => readdirSync(root).filter((n) => n.startsWith('.staging-'));

describe('P-12 보완 (a) 저장 전 종료 플래그 — 멈춤 지점별', () => {
  it('3N 시작 직전 → io·T 미생성·스테이징 0', async () => {
    const root = mkRoot();
    const lazy: Lazy = {};
    const base: VerifyFetchFn = okFetchFor(ID);
    lazy.h = await bootAt(root, {
      fetch: async (url, init) => {
        stopNow(lazy);
        return base(url, init);
      },
    });
    const res = await lazy.h.request('POST', '/api/connect', connectBody());
    expect(await res.json()).toEqual({ code: 'KEY_STORE_FAILED', params: { reason: 'io' } });
    expect(existsSync(join(root, ID))).toBe(false);
    expect(stagingLeft(root)).toEqual([]);
  });

  it('rename(S→T) 직전 → io·T 미생성·스테이징 삭제', async () => {
    const root = mkRoot();
    const lazy: Lazy = {};
    const real = productionDeps({}, 'UTC').migrateDatabase;
    lazy.h = await bootAt(root, {
      over: {
        migrateDatabase: async (dir, opts) => {
          const handle = await real(dir, opts);
          if (dir.includes('.staging-')) {
            stopNow(lazy);
          }
          return handle;
        },
      },
    });
    const res = await lazy.h.request('POST', '/api/connect', connectBody());
    expect(await res.json()).toEqual({ code: 'KEY_STORE_FAILED', params: { reason: 'io' } });
    expect(existsSync(join(root, ID))).toBe(false);
    expect(stagingLeft(root)).toEqual([]);
  });

  it('3E (a) 직전 → io·백업 0·키·옵션 이전 그대로', async () => {
    const root = mkRoot();
    const lazy: Lazy = {};
    const base: VerifyFetchFn = okFetchFor(ID);
    lazy.h = await bootAt(root, {
      fetch: async (url, init) => {
        stopNow(lazy);
        return base(url, init);
      },
    });
    const target = join(root, ID);
    await seedDb(target, { steamId: ID, prefs: { locale: 'ko' } });
    const res = await lazy.h.request('POST', '/api/connect', connectBody({ achievementsEnabled: true }));
    expect(await res.json()).toEqual({ code: 'KEY_STORE_FAILED', params: { reason: 'io' } });
    expect(existsSync(join(target, 'backups'))).toBe(false);
    expect(existsSync(join(target, 'steam.key'))).toBe(false);
    expect(readPref(target, 'locale')).toBe('ko');
    expect(readPref(target, 'achievement_enabled')).toBeNull();
  });

  it('3E (b) 직전(백업 직후) → io·백업 남음·키·옵션 이전 그대로', async () => {
    const root = mkRoot();
    const lazy: Lazy = {};
    const realBackup = productionDeps({}, 'UTC').backupDatabase;
    lazy.h = await bootAt(root, {
      over: {
        backupDatabase: async (dir) => {
          await realBackup(dir);
          stopNow(lazy);
        },
      },
    });
    const target = join(root, ID);
    await seedDb(target, { steamId: ID, prefs: { locale: 'ko' } });
    const res = await lazy.h.request('POST', '/api/connect', connectBody({ achievementsEnabled: true }));
    expect(await res.json()).toEqual({ code: 'KEY_STORE_FAILED', params: { reason: 'io' } });
    expect(readdirSync(join(target, 'backups')).length).toBe(1);
    expect(existsSync(join(target, 'steam.key'))).toBe(false);
    expect(readPref(target, 'achievement_enabled')).toBeNull();
  });

  it('3E (c) 직전(마이그레이션 직후) → io·키·옵션 이전 그대로', async () => {
    const root = mkRoot();
    const lazy: Lazy = {};
    const real = productionDeps({}, 'UTC').migrateDatabase;
    lazy.h = await bootAt(root, {
      over: {
        migrateDatabase: async (dir, opts) => {
          const handle = await real(dir, opts);
          if (!dir.includes('.staging-')) {
            stopNow(lazy);
          }
          return handle;
        },
      },
    });
    const target = join(root, ID);
    await seedDb(target, { steamId: ID, prefs: { locale: 'ko' } });
    const res = await lazy.h.request('POST', '/api/connect', connectBody({ achievementsEnabled: true }));
    expect(await res.json()).toEqual({ code: 'KEY_STORE_FAILED', params: { reason: 'io' } });
    expect(existsSync(join(target, 'steam.key'))).toBe(false);
    expect(readPref(target, 'locale')).toBe('ko');
    expect(readPref(target, 'achievement_enabled')).toBeNull();
  });
});

describe('P-12 보완 (b)(c) 4 직전 종료·3E 경로 4 실패', () => {
  it('(b) 3E (c) 반영 뒤 4 직전 종료 → shutdown·공개 0·recover 0·키·옵션 반영 유지', async () => {
    const root = mkRoot();
    const lazy: Lazy = {};
    const real = productionDeps({}, 'UTC').migrateDatabase;
    let dbReads = 0;
    lazy.h = await bootAt(root, {
      over: {
        migrateDatabase: async (dir, opts) => {
          const handle = (await real(dir, opts)) as unknown as { db: unknown; close: () => Promise<void> };
          if (dir.includes('.staging-')) {
            return handle as never;
          }
          // attach가 (c) persist에 db를 넘기는 두 번째 읽기에서 종료를 건다 → 저장 후·4 직전에 플래그가 서 있다.
          return {
            get db() {
              dbReads += 1;
              if (dbReads === 2) {
                stopNow(lazy);
              }
              return handle.db;
            },
            close: () => handle.close(),
          } as never;
        },
      },
    });
    const target = join(root, ID);
    await seedDb(target, { steamId: ID, prefs: { locale: 'ko' } });
    const res = await lazy.h.request('POST', '/api/connect', connectBody({ achievementsEnabled: true }));
    expect(await res.json()).toEqual({ code: 'KEY_STORE_FAILED', params: { reason: 'shutdown' } });
    expect(readFileSync(join(target, 'steam.key'), 'utf8')).toBe(KEY);
    expect(readPref(target, 'achievement_enabled')).toBe('1');
    expect(lazy.h.calls).toEqual([]);
  });

  it('(c) 3E 경로에서 4 실패 → attach·(c) 반영 유지·미부착·다음 connect가 이어받음', async () => {
    const root = mkRoot();
    let services = 0;
    const h = await bootAt(root, {
      over: {
        createSyncService: () => {
          services += 1;
          if (services === 1) {
            throw new Error('injected');
          }
          return { recover: async () => undefined, stop: async () => undefined } as unknown as SyncService;
        },
      },
    });
    const target = join(root, ID);
    await seedDb(target, { steamId: ID, prefs: { locale: 'ko' } });
    const res = await h.request('POST', '/api/connect', connectBody({ achievementsEnabled: true }));
    expect(await res.json()).toEqual({ code: 'KEY_STORE_FAILED', params: { reason: 'attach' } });
    expect(readFileSync(join(target, 'steam.key'), 'utf8')).toBe(KEY);
    expect(readPref(target, 'achievement_enabled')).toBe('1');
    expect(await (await h.request('GET', '/api/connect/status')).json()).toMatchObject({ connected: false });
    expect((await h.request('POST', '/api/connect', connectBody())).status).toBe(200);
    expect((await h.request('GET', '/api/library')).status).toBe(200);
  });
});

describe('P-12 보완 (d)(e) 부착 실패 뒤 PUT·GET 대기', () => {
  it('(d) 부착 실패(attach) 뒤 PUT prefs·업적은 메모리로 — T DB 0', async () => {
    const root = mkRoot();
    const real = productionDeps({}, 'UTC').migrateDatabase;
    let targetOpens = 0;
    const h = await bootAt(root, {
      over: {
        migrateDatabase: async (dir, opts) => {
          if (!dir.includes('.staging-')) {
            targetOpens += 1;
            if (targetOpens === 1) {
              throw new Error('injected');
            }
          }
          return real(dir, opts);
        },
      },
    });
    const fail = await h.request('POST', '/api/connect', connectBody());
    expect(await fail.json()).toEqual({ code: 'KEY_STORE_FAILED', params: { reason: 'attach' } });
    const put = await h.request('PUT', '/api/prefs?fallback=ko', { locale: 'en' });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ locale: 'en' });
    await h.request('PUT', '/api/settings/achievements', { enabled: true });
    expect(await (await h.request('GET', '/api/prefs?fallback=ko')).json()).toMatchObject({ locale: 'en' });
    expect(await (await h.request('GET', '/api/settings/achievements')).json()).toEqual({ enabled: true });
    expect(readPref(join(root, ID), 'locale')).toBeNull();
    expect(readPref(join(root, ID), 'achievement_enabled')).toBeNull();
  });

  it('(e) connect 진행 중에도 GET은 대기 없이 응답', async () => {
    const root = mkRoot();
    const gate = gatedFetch(ID);
    const h = await bootAt(root, { fetch: gate.fn });
    const connecting = h.request('POST', '/api/connect', connectBody());
    await new Promise((r) => setTimeout(r, 20));
    const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 500));
    for (const path of ['/api/prefs?fallback=ko', '/api/settings/achievements', '/api/connect/status']) {
      const got = await Promise.race([h.request('GET', path), timeout]);
      expect([path, got === 'timeout' ? 'timeout' : got.status]).toEqual([path, 200]);
    }
    gate.release();
    expect((await connecting).status).toBe(200);
  });
});

describe('P-12 보완 (f) 종료 drain 상한', () => {
  it('connect가 상한을 넘기면 shutdown은 기다리지 않고 진행·이후 connect는 저장 0', async () => {
    const root = mkRoot();
    const gate = nonAbortableGate(ID);
    const h = await bootAt(root, { fetch: gate.fn, over: { connectDrainMs: 30 } });
    const connecting = h.request('POST', '/api/connect', connectBody());
    await new Promise((r) => setTimeout(r, 20));
    const started = Date.now();
    const settled = await Promise.race([
      h.booted.shutdown().then(() => 'down' as const),
      new Promise<'stuck'>((r) => setTimeout(() => r('stuck'), 3000)),
    ]);
    expect(settled).toBe('down');
    expect(Date.now() - started).toBeLessThan(3000);
    // 남은 connect는 풀려도 플래그를 보고 저장 없이 멈춘다.
    gate.release();
    const res = await connecting;
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(existsSync(join(root, ID))).toBe(false);
    expect(stagingLeft(root)).toEqual([]);
  });
});

describe('P-12 보완 (g) T 잠금 재사용·실패', () => {
  it('attach 실패 뒤 같은 T 재시도 → 같은 잠금 연결을 재사용(자기 BUSY 0)', async () => {
    const root = mkRoot();
    const real = productionDeps({}, 'UTC').migrateDatabase;
    const lockByDir = new Map<string, unknown[]>();
    let targetOpens = 0;
    const { acquireOwnerLock } = await import('../../src/db/ownerLock.js');
    const h = await bootAt(root, {
      over: {
        acquireOwnerLock: (dir) => {
          const lock = acquireOwnerLock(dir);
          lockByDir.set(dir, [...(lockByDir.get(dir) ?? []), lock]);
          return lock;
        },
        migrateDatabase: async (dir, opts) => {
          if (!dir.includes('.staging-')) {
            targetOpens += 1;
            if (targetOpens === 1) {
              throw new Error('injected');
            }
          }
          return real(dir, opts);
        },
      },
    });
    const fail = await h.request('POST', '/api/connect', connectBody());
    expect(await fail.json()).toEqual({ code: 'KEY_STORE_FAILED', params: { reason: 'attach' } });
    const again = await h.request('POST', '/api/connect', connectBody());
    expect(again.status).toBe(200);
    const targetLocks = [...lockByDir.entries()].filter(([dir]) => dir.endsWith(ID)).flatMap(([, v]) => v);
    expect(targetLocks.length).toBeGreaterThanOrEqual(2);
    expect(new Set(targetLocks).size).toBe(1);
  });

  it('T 잠금 취득 실패 → dir_conflict·T 무변경', async () => {
    const root = mkRoot();
    const { acquireOwnerLock } = await import('../../src/db/ownerLock.js');
    const h = await bootAt(root, {
      over: {
        acquireOwnerLock: (dir) => {
          if (dir.endsWith(ID)) {
            throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' });
          }
          return acquireOwnerLock(dir);
        },
      },
    });
    const target = join(root, ID);
    await seedDb(target, { steamId: ID, prefs: { locale: 'ko' } });
    const res = await h.request('POST', '/api/connect', connectBody());
    expect(await res.json()).toEqual({ code: 'KEY_STORE_FAILED', params: { reason: 'dir_conflict' } });
    expect(existsSync(join(target, 'steam.key'))).toBe(false);
    expect(existsSync(join(target, 'backups'))).toBe(false);
    expect(readPref(target, 'locale')).toBe('ko');
  });
});

describe('P-12 보완 (h) ① QUESTAIL_DATA_DIR', () => {
  it('D 잠금만 취득·R 잠금·정리·하위 계정 폴더 해석 0', async () => {
    const dir = mkRoot();
    const unusedRoot = mkRoot();
    await seedDb(dir, { steamId: ID });
    // ②였다면 계정 폴더 판정(레거시+계정 폴더 → 기동 실패)·⑤ 정리 대상이 되는 항목들.
    await seedDb(join(dir, OTHER_ID), { steamId: OTHER_ID });
    const dead = `.staging-${ID}-1999999-bbbb`;
    mkdirSync(join(dir, dead));
    const { acquireOwnerLock } = await import('../../src/db/ownerLock.js');
    const locked: string[] = [];
    const h = await bootAt(dir, {
      over: {
        env: { QUESTAIL_DATA_DIR: dir },
        dataRoot: unusedRoot,
        acquireOwnerLock: (d) => {
          locked.push(d);
          return acquireOwnerLock(d);
        },
      },
    });
    expect(locked).toEqual([dir]);
    expect(existsSync(join(dir, dead))).toBe(true);
    expect(readdirSync(unusedRoot)).toEqual([]);
    const info = (await (await h.request('GET', '/api/settings/info')).json()) as { dataDir: string };
    expect(info.dataDir).toBe(dir);
    expect(await (await h.request('GET', '/api/connect/status')).json()).toMatchObject({
      connected: true,
      steamId: ID,
    });
  });
});

describe('P-12 보완 (i) steamId 비형식 — Steam 요청 전 거부', () => {
  const notFound = { code: 'AUTH_ID_MISMATCH', params: { reason: 'not_found' } };

  it('미부착: body steamId 비형식 → 409 not_found·fetch 0·파일 0', async () => {
    const root = mkRoot();
    let calls = 0;
    const h = await bootAt(root, {
      fetch: async (url, init) => {
        calls += 1;
        return okFetchFor(ID)(url, init);
      },
    });
    const before = readdirSync(root);
    for (const bad of ['123', '7656119800000000', '765611980000000011', 'abc', '7656119800000000a']) {
      const res = await h.request('POST', '/api/connect', connectBody({ steamId: bad }));
      expect([bad, res.status]).toEqual([bad, 409]);
      expect(await res.json()).toEqual(notFound);
    }
    expect(calls).toBe(0);
    expect(readdirSync(root)).toEqual(before);
  });

  it('미부착 vanity: resolve 결과 id가 비형식 → Steam 검증 요청 0(vanity 해석 1회만)', async () => {
    const root = mkRoot();
    const urls: string[] = [];
    const h = await bootAt(root, {
      fetch: async (url) => {
        urls.push(url);
        return { status: 200, json: async () => ({ response: { success: 1, steamid: '123' } }) };
      },
    });
    const res = await h.request('POST', '/api/connect', connectBody({ vanity: 'someone' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(notFound);
    expect(urls.length).toBe(1);
    expect(urls[0]).toContain('ResolveVanityURL');
  });

  it('부착: body steamId 비형식 → 409 not_found·fetch 0', async () => {
    const root = mkRoot();
    await seedDb(join(root, ID), { steamId: ID });
    let calls = 0;
    const h = await bootAt(root, {
      fetch: async (url, init) => {
        calls += 1;
        return okFetchFor(ID)(url, init);
      },
    });
    const res = await h.request('POST', '/api/connect', connectBody({ steamId: '123' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(notFound);
    expect(calls).toBe(0);
  });
});

describe('P-12 보완 (j) 시작 6 — recover 뒤 종료', () => {
  it('recover 뒤 종료면 registerCron 호출 0', async () => {
    const root = mkRoot();
    let releaseRecover!: () => void;
    const recoverGate = new Promise<void>((resolve) => {
      releaseRecover = resolve;
    });
    const h = await bootAt(root, { recover: () => recoverGate });
    expect((await h.request('POST', '/api/connect', connectBody())).status).toBe(200);
    const down = h.booted.shutdown();
    await new Promise((r) => setTimeout(r, 20));
    releaseRecover();
    await down;
    expect(h.calls).toEqual(['recover', 'stop']);
    expect(h.calls).not.toContain('cron');
  });

  it('시작 6 실패 로그: 소스·원인 코드 1줄, 키·경로 원문 0', async () => {
    const root = mkRoot();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = await bootAt(root, {
      recover: () => Promise.reject(Object.assign(new Error(`${root} ${KEY}`), { code: 'EACCES' })),
    });
    expect((await h.request('POST', '/api/connect', connectBody())).status).toBe(200);
    await h.booted.shutdown();
    const lines = err.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('start failed'));
    expect(lines).toEqual(['[web] post-attach start failed source=recover code=EACCES']);
    expect(err.mock.calls.flat().join(' ')).not.toContain(KEY);
    expect(err.mock.calls.flat().join(' ')).not.toContain(root);
  });
});
