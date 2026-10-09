import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VerifyFetchFn } from '../../src/data/connection.js';
import { createApp, createServerApp } from '../../src/server/app.js';
import {
  CONNECT_PATH,
  CONNECT_STATUS_PATH,
  connectKeyPath,
} from '../../src/server/routes/connect.js';

/**
 * W5 연동 라우트 단위. 합성 DB(제품 SQL) + 임시 dataDir + 가짜 Steam fetch.
 * 실키·실호출 없음.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOST = { host: '127.0.0.1:4747' };
const JSON_HEADERS = { ...HOST, 'content-type': 'application/json' };
const DUMMY_KEY = 'abcdef0123456789abcdef0123456789';
const STEAM_ID = '76561198000000001';

function freshDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-w5-'));
  const journal = JSON.parse(
    readFileSync(join(WEB, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const setup = new Database(join(dir, 'questail.db'));
  try {
    for (const entry of journal.entries) {
      setup.exec(readFileSync(join(WEB, 'drizzle', `${entry.tag}.sql`), 'utf8'));
    }
  } finally {
    setup.close();
  }
  return { dir, db: new Database(join(dir, 'questail.db')) };
}

function okFetch(steamId: string): VerifyFetchFn {
  return async () => ({
    status: 200,
    json: async () => ({ response: { players: [{ steamid: steamId }] } }),
  });
}

function statusFetch(status: number, body: unknown = {}): VerifyFetchFn {
  return async () => ({ status, json: async () => body });
}

async function postConnect(
  app: ReturnType<typeof createApp>,
  body: unknown,
): Promise<Response> {
  return await app.request(CONNECT_PATH, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

describe('GET /api/connect/status', () => {
  it('미연동 → {connected:false, steamId:null}', async () => {
    const { dir, db } = freshDb();
    try {
      const app = createApp(undefined, { db, keyPath: connectKeyPath(dir) });
      const response = await app.request(CONNECT_STATUS_PATH, { headers: HOST });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        connected: false,
        steamId: null,
        permissionEnforced: process.platform !== 'win32',
      });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deps 없음 → 500 INTERNAL(배선 fault)', async () => {
    const response = await createServerApp().request(CONNECT_STATUS_PATH, {
      headers: HOST,
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'INTERNAL', params: {} });
  });
});

describe('POST /api/connect', () => {
  it('성공 → 200 {connected:true} + 키 파일·status 반영', async () => {
    const { dir, db } = freshDb();
    try {
      const keyPath = connectKeyPath(dir);
      const app = createApp(undefined, { db, keyPath, fetchFn: okFetch(STEAM_ID) });
      const response = await postConnect(app, { keyText: DUMMY_KEY, steamId: STEAM_ID });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ connected: true });
      expect(readFileSync(keyPath, 'utf8')).toBe(DUMMY_KEY);
      const status = await app.request(CONNECT_STATUS_PATH, { headers: HOST });
      expect(await status.json()).toEqual({
        connected: true,
        steamId: STEAM_ID,
        permissionEnforced: process.platform !== 'win32',
      });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('형태 오류 → 400 AUTH_INVALID_KEY{format}, Steam 호출 없음', async () => {
    const { dir, db } = freshDb();
    try {
      let called = false;
      const app = createApp(undefined, {
        db,
        keyPath: connectKeyPath(dir),
        fetchFn: async () => {
          called = true;
          return { status: 200, json: async () => ({}) };
        },
      });
      const response = await postConnect(app, { keyText: 'not-a-key', steamId: STEAM_ID });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        code: 'AUTH_INVALID_KEY',
        params: { reason: 'format' },
      });
      expect(called).toBe(false);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('가드 타입 오류 → 400 INVALID_BODY, keyText 미반향', async () => {
    const { dir, db } = freshDb();
    try {
      const app = createApp(undefined, { db, keyPath: connectKeyPath(dir) });
      const response = await postConnect(app, { keyText: DUMMY_KEY });
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain('INVALID_BODY');
      expect(text).not.toContain(DUMMY_KEY);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Steam 거부(401) → 400 AUTH_INVALID_KEY{rejected}', async () => {
    const { dir, db } = freshDb();
    try {
      const app = createApp(undefined, {
        db,
        keyPath: connectKeyPath(dir),
        fetchFn: statusFetch(401),
      });
      const response = await postConnect(app, { keyText: DUMMY_KEY, steamId: STEAM_ID });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        code: 'AUTH_INVALID_KEY',
        params: { reason: 'rejected' },
      });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('429 → 429 RATE_LIMITED, 5xx → 502 NETWORK{upstream}', async () => {
    const { dir, db } = freshDb();
    try {
      const limited = createApp(undefined, {
        db,
        keyPath: connectKeyPath(dir),
        fetchFn: statusFetch(429),
      });
      const r1 = await postConnect(limited, { keyText: DUMMY_KEY, steamId: STEAM_ID });
      expect(r1.status).toBe(429);
      expect(await r1.json()).toEqual({ code: 'RATE_LIMITED', params: {} });
      const upstream = createApp(undefined, {
        db,
        keyPath: connectKeyPath(dir),
        fetchFn: statusFetch(500),
      });
      const r2 = await postConnect(upstream, { keyText: DUMMY_KEY, steamId: STEAM_ID });
      expect(r2.status).toBe(502);
      expect(await r2.json()).toEqual({
        code: 'NETWORK',
        params: { reason: 'upstream' },
      });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('빈 players → 409 AUTH_ID_MISMATCH{not_found}', async () => {
    const { dir, db } = freshDb();
    try {
      const app = createApp(undefined, {
        db,
        keyPath: connectKeyPath(dir),
        fetchFn: statusFetch(200, { response: { players: [] } }),
      });
      const response = await postConnect(app, { keyText: DUMMY_KEY, steamId: STEAM_ID });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        code: 'AUTH_ID_MISMATCH',
        params: { reason: 'not_found' },
      });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('고정 ID 거부 — 다른 SteamID 입력이면 Steam 호출 없이 409{fixed_id}', async () => {
    const { dir, db } = freshDb();
    try {
      let calls = 0;
      const counting: VerifyFetchFn = async () => {
        calls += 1;
        return { status: 200, json: async () => ({ response: { players: [{ steamid: STEAM_ID }] } }) };
      };
      const keyPath = connectKeyPath(dir);
      const app = createApp(undefined, { db, keyPath, fetchFn: counting });
      const first = await postConnect(app, { keyText: DUMMY_KEY, steamId: STEAM_ID });
      expect(first.status).toBe(200);
      expect(calls).toBe(1);
      const second = await postConnect(app, { keyText: DUMMY_KEY, steamId: '76561198000000002' });
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({
        code: 'AUTH_ID_MISMATCH',
        params: { reason: 'fixed_id' },
      });
      expect(calls).toBe(1);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('동시 POST → 한쪽 409 CONNECT_IN_PROGRESS', async () => {
    const { dir, db } = freshDb();
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const gated: VerifyFetchFn = async () => {
        await gate;
        return { status: 200, json: async () => ({ response: { players: [{ steamid: STEAM_ID }] } }) };
      };
      const app = createApp(undefined, { db, keyPath: connectKeyPath(dir), fetchFn: gated });
      const body = { keyText: DUMMY_KEY, steamId: STEAM_ID };
      const first = postConnect(app, body);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const second = await postConnect(app, body);
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({ code: 'CONNECT_IN_PROGRESS', params: {} });
      release();
      expect((await first).status).toBe(200);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
