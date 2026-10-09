import { describe, expect, it } from 'vitest';
import {
  createSteamSpyLimiter,
  deriveSteamSpyUserTags,
  fetchSteamSpyUserTags,
} from '@questail/core';
import type { SteamSpyFetchFn } from '@questail/core';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * D-17 SteamSpy 태그 테스트. 합성 응답·가짜 fetch/clock만 쓴다. 실호출 없음.
 * 캐시는 mkdtemp 고유 경로에만 쓴다.
 */
function freshCacheDir(): string {
  return mkdtempSync(join(tmpdir(), 'questail-nozi-steamspy-'));
}

function tagsBody(tags: Record<string, number>): unknown {
  return { tags };
}

function okFetch(body: unknown, seen?: { url: string; count: number }): SteamSpyFetchFn {
  return async (url: string) => {
    if (seen) {
      seen.url = url;
      seen.count += 1;
    }
    return { status: 200, json: async () => body };
  };
}

function statusFetch(status: number): SteamSpyFetchFn {
  return async () => ({ status, json: async () => ({}) });
}

describe('deriveSteamSpyUserTags', () => {
  it('상위 10개를 투표 내림차순으로 낸다', () => {
    const tags: Record<string, number> = {};
    for (let i = 0; i < 15; i += 1) tags[`Tag${i}`] = 100 - i;
    const out = deriveSteamSpyUserTags({ tags });
    expect(out.length).toBe(10);
    expect(out[0]).toEqual({ tag: 'Tag0', votes: 100 });
    expect(out[9]).toEqual({ tag: 'Tag9', votes: 91 });
  });

  it('동점은 태그명 오름차순이다', () => {
    const out = deriveSteamSpyUserTags({ tags: { b: 5, a: 5, c: 5 } });
    expect(out.map((t) => t.tag)).toEqual(['a', 'b', 'c']);
  });
});

describe('fetchSteamSpyUserTags', () => {
  it('빈 tags는 empty이며 성공 raw를 캐시한다', async () => {
    const cacheDir = freshCacheDir();
    const seen = { url: '', count: 0 };
    const result = await fetchSteamSpyUserTags({
      appId: '10',
      cacheDir,
      fetchFn: okFetch({ tags: {} }, seen),
      limiter: createSteamSpyLimiter(),
    });
    expect(result).toEqual({ status: 'empty', tags: [] });
    expect(seen.url).toBe('https://steamspy.com/api.php?request=appdetails&appid=10');
    expect(existsSync(join(cacheDir, '10.json'))).toBe(true);
  });

  it('실패 상태는 failed이며 캐시에 쓰지 않는다', async () => {
    const cacheDir = freshCacheDir();
    const cases: { appId: string; fetchFn: SteamSpyFetchFn }[] = [
      { appId: '20', fetchFn: statusFetch(500) },
      { appId: '21', fetchFn: statusFetch(429) },
    ];
    for (const { appId, fetchFn } of cases) {
      const result = await fetchSteamSpyUserTags({
        appId,
        cacheDir,
        fetchFn,
        limiter: createSteamSpyLimiter(),
      });
      expect(result).toEqual({ status: 'failed', tags: [] });
      expect(existsSync(join(cacheDir, `${appId}.json`))).toBe(false);
    }
    const down: SteamSpyFetchFn = async () => {
      throw new Error('down');
    };
    const net = await fetchSteamSpyUserTags({
      appId: '22',
      cacheDir,
      fetchFn: down,
      limiter: createSteamSpyLimiter(),
    });
    expect(net).toEqual({ status: 'failed', tags: [] });
  });

  it('깨진 본문·tags 부재는 failed이며 캐시에 쓰지 않는다', async () => {
    const cacheDir = freshCacheDir();
    const broken: SteamSpyFetchFn = async () => ({
      status: 200,
      json: async () => {
        throw new Error('bad json');
      },
    });
    await expect(
      fetchSteamSpyUserTags({ appId: '30', cacheDir, fetchFn: broken, limiter: createSteamSpyLimiter() }),
    ).resolves.toEqual({ status: 'failed', tags: [] });
    await expect(
      fetchSteamSpyUserTags({
        appId: '31',
        cacheDir,
        fetchFn: okFetch({ response: {} }),
        limiter: createSteamSpyLimiter(),
      }),
    ).resolves.toEqual({ status: 'failed', tags: [] });
    await expect(
      fetchSteamSpyUserTags({
        appId: '32',
        cacheDir,
        fetchFn: okFetch({ response: { tags: 'x' } }),
        limiter: createSteamSpyLimiter(),
      }),
    ).resolves.toEqual({ status: 'failed', tags: [] });
    expect(existsSync(join(cacheDir, '30.json'))).toBe(false);
    expect(existsSync(join(cacheDir, '31.json'))).toBe(false);
    expect(existsSync(join(cacheDir, '32.json'))).toBe(false);
  });

  it('캐시 적중은 호출 없이 파생만 낸다', async () => {
    const cacheDir = freshCacheDir();
    writeFileSync(
      join(cacheDir, '40.json'),
      JSON.stringify({ v: 1, appId: '40', fetchedAt: 1, raw: tagsBody({ Solo: 7 }) }),
      'utf8',
    );
    let calls = 0;
    const counting: SteamSpyFetchFn = async () => {
      calls += 1;
      return { status: 200, json: async () => ({}) };
    };
    const result = await fetchSteamSpyUserTags({
      appId: '40',
      cacheDir,
      fetchFn: counting,
      limiter: createSteamSpyLimiter(),
    });
    expect(result).toEqual({ status: 'ready', tags: [{ tag: 'Solo', votes: 7 }] });
    expect(calls).toBe(0);
  });

  it('bypass는 캐시를 읽지 않고 성공 시 새로 쓴다', async () => {
    const cacheDir = freshCacheDir();
    writeFileSync(
      join(cacheDir, '50.json'),
      JSON.stringify({ v: 1, appId: '50', fetchedAt: 1, raw: tagsBody({ Old: 1 }) }),
      'utf8',
    );
    const result = await fetchSteamSpyUserTags({
      appId: '50',
      cacheDir,
      bypassCache: true,
      fetchFn: okFetch(tagsBody({ New: 9 })),
      limiter: createSteamSpyLimiter(),
    });
    expect(result).toEqual({ status: 'ready', tags: [{ tag: 'New', votes: 9 }] });
    const stored = JSON.parse(readFileSync(join(cacheDir, '50.json'), 'utf8')) as { raw: unknown };
    expect(stored.raw).toEqual(tagsBody({ New: 9 }));
  });

  it('연속 호출 간격은 1000ms 이상이다(가짜 clock)', async () => {
    const cacheDir = freshCacheDir();
    let t = 10_000;
    const at: number[] = [];
    const clock = {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
    };
    const fetchFn: SteamSpyFetchFn = async () => {
      at.push(t);
      return { status: 200, json: async () => tagsBody({ A: 1 }) };
    };
    const limiter = createSteamSpyLimiter();
    await fetchSteamSpyUserTags({ appId: '60', cacheDir, fetchFn, clock, limiter });
    await fetchSteamSpyUserTags({ appId: '61', cacheDir, fetchFn, clock, limiter });
    expect(at.length).toBe(2);
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(1000);
  });
});
