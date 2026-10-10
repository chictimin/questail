import { describe, expect, it } from 'vitest';
import {
  createSteamSpyLimiter,
  fetchSteamSpyUserTags,
} from '@questail/core';
import type { SteamSpyFetchFn } from '@questail/core';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * U3a #15 SteamSpy 분류·실패 사유 테스트. 합성 응답·가짜 fetch/clock만 쓴다. 실호출 없음.
 * 캡처(10-10) 예: {"appid":1472220,"name":"Tree of Life: Oddria! Playtest",...,"tags":[]} HTTP 200.
 */
function freshCacheDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-u3aspy-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function okFetch(body: unknown): SteamSpyFetchFn {
  return async () => ({ status: 200, json: async () => body });
}

function storedRaw(cacheDir: string, appId: string): unknown {
  return (JSON.parse(readFileSync(join(cacheDir, `${appId}.json`), 'utf8')) as { raw: unknown })
    .raw;
}

describe('steamspy 분류', () => {
  it('캡처형 tags:[] → empty + 캐시', async () => {
    const { dir, cleanup } = freshCacheDir();
    try {
      const raw = { appid: 1472220, name: 'Tree of Life: Oddria! Playtest', tags: [] };
      const result = await fetchSteamSpyUserTags({
        appId: '1472220',
        cacheDir: dir,
        fetchFn: okFetch(raw),
        limiter: createSteamSpyLimiter(),
      });
      expect(result).toEqual({ status: 'empty', tags: [] });
      expect(existsSync(join(dir, '1472220.json'))).toBe(true);
      expect(storedRaw(dir, '1472220')).toEqual(raw);
    } finally {
      cleanup();
    }
  });

  it('tags 객체 → ready', async () => {
    const { dir, cleanup } = freshCacheDir();
    try {
      const result = await fetchSteamSpyUserTags({
        appId: '10',
        cacheDir: dir,
        fetchFn: okFetch({ appid: 10, tags: { Roguelike: 50, Indie: 30 } }),
        limiter: createSteamSpyLimiter(),
      });
      expect(result).toEqual({
        status: 'ready',
        tags: [
          { tag: 'Roguelike', votes: 50 },
          { tag: 'Indie', votes: 30 },
        ],
      });
    } finally {
      cleanup();
    }
  });

  it('비어 있지 않은 배열·tags 부재·appid 불일치·비객체 → failed corrupt·캐시 0', async () => {
    const { dir, cleanup } = freshCacheDir();
    try {
      const cases: { appId: string; body: unknown }[] = [
        { appId: '20', body: { appid: 20, tags: ['Roguelike'] } },
        { appId: '21', body: { appid: 21, name: 'x' } },
        { appId: '22', body: { appid: 999, tags: [] } },
        { appId: '23', body: 'bad' },
      ];
      for (const { appId, body } of cases) {
        await expect(
          fetchSteamSpyUserTags({ appId, cacheDir: dir, fetchFn: okFetch(body), limiter: createSteamSpyLimiter() }),
        ).resolves.toEqual({ status: 'failed', tags: [], failure: { reason: 'corrupt' } });
        expect(existsSync(join(dir, `${appId}.json`))).toBe(false);
      }
    } finally {
      cleanup();
    }
  });

  it('비200 → http + status', async () => {
    const { dir, cleanup } = freshCacheDir();
    try {
      const fetchFn: SteamSpyFetchFn = async () => ({ status: 500, json: async () => ({}) });
      await expect(
        fetchSteamSpyUserTags({ appId: '30', cacheDir: dir, fetchFn, limiter: createSteamSpyLimiter() }),
      ).resolves.toEqual({ status: 'failed', tags: [], failure: { reason: 'http', status: 500 } });
      expect(existsSync(join(dir, '30.json'))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('비숫자 appId → invalid_appid, fetch 호출 0', async () => {
    const { dir, cleanup } = freshCacheDir();
    try {
      let calls = 0;
      const counting: SteamSpyFetchFn = async () => {
        calls += 1;
        return { status: 200, json: async () => ({}) };
      };
      await expect(
        fetchSteamSpyUserTags({ appId: 'abc', cacheDir: dir, fetchFn: counting, limiter: createSteamSpyLimiter() }),
      ).resolves.toEqual({ status: 'failed', tags: [], failure: { reason: 'invalid_appid' } });
      expect(calls).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('fetch 예외 → network', async () => {
    const { dir, cleanup } = freshCacheDir();
    try {
      const down: SteamSpyFetchFn = async () => {
        throw new Error('down');
      };
      await expect(
        fetchSteamSpyUserTags({ appId: '31', cacheDir: dir, fetchFn: down, limiter: createSteamSpyLimiter() }),
      ).resolves.toEqual({ status: 'failed', tags: [], failure: { reason: 'network' } });
    } finally {
      cleanup();
    }
  });

  it('외부 signal abort → network', async () => {
    const { dir, cleanup } = freshCacheDir();
    try {
      const ctrl = new AbortController();
      ctrl.abort();
      let calls = 0;
      const counting: SteamSpyFetchFn = async () => {
        calls += 1;
        return { status: 200, json: async () => ({}) };
      };
      await expect(
        fetchSteamSpyUserTags({
          appId: '32',
          cacheDir: dir,
          fetchFn: counting,
          signal: ctrl.signal,
          limiter: createSteamSpyLimiter(),
        }),
      ).resolves.toEqual({ status: 'failed', tags: [], failure: { reason: 'network' } });
      expect(calls).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('타임아웃 → timeout(실타이머 15초, AbortSignal.timeout 내부 타이머는 가짜 타이머로 안 돈다)', { timeout: 30_000 }, async () => {
    const { dir, cleanup } = freshCacheDir();
    try {
      const abortReject: SteamSpyFetchFn = async (_url, init) => {
        await new Promise<void>((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
        throw new Error('unreachable');
      };
      await expect(
        fetchSteamSpyUserTags({
          appId: '33',
          cacheDir: dir,
          fetchFn: abortReject,
          limiter: createSteamSpyLimiter(),
        }),
      ).resolves.toEqual({ status: 'failed', tags: [], failure: { reason: 'timeout' } });
    } finally {
      cleanup();
    }
  });

  it('캐시 hit tags:[] → empty, fetch 호출 0', async () => {
    const { dir, cleanup } = freshCacheDir();
    try {
      writeFileSync(
        join(dir, '40.json'),
        JSON.stringify({ v: 1, appId: '40', fetchedAt: 1, raw: { appid: 40, tags: [] } }),
        'utf8',
      );
      let calls = 0;
      const counting: SteamSpyFetchFn = async () => {
        calls += 1;
        return { status: 200, json: async () => ({}) };
      };
      await expect(
        fetchSteamSpyUserTags({ appId: '40', cacheDir: dir, fetchFn: counting, limiter: createSteamSpyLimiter() }),
      ).resolves.toEqual({ status: 'empty', tags: [] });
      expect(calls).toBe(0);
    } finally {
      cleanup();
    }
  });
});
