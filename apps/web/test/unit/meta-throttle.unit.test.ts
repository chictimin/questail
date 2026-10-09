import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppMetaRateLimitedError, fetchAppMetaBatch, fetchAppMetaStatus } from '@questail/core';

/**
 * D-07 메타 스로틀·캐시 테스트. 가짜 fetch·clock만 쓴다. 실호출 없음.
 * 단일 locale 1요청(P-9). 자동 재시도 없음(v1.5.2).
 */
function envelope(appId: string, name: string) {
  return { [appId]: { success: true, data: { name, genres: [{ id: '1', description: 'Action' }] } } };
}

function fakeFetch(handler: (url: string) => { status: number; body: unknown }) {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const { status, body } = handler(url);
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  }) as never;
  return { fn, calls };
}

describe('meta throttle/cache', () => {
  it('간격 기본 2초를 강제한다', async () => {
    const { fn, calls } = fakeFetch((url: string) => {
      const appId = new URL(url).searchParams.get('appids') ?? '1';
      return { status: 200, body: envelope(appId, 'g') };
    });
    const slept: number[] = [];
    let now = 1_000_000;
    const opts = {
      cacheDir: mkdtempSync(join(tmpdir(), 'questail-d07-')),
      fetchFn: fn,
      now: () => now,
      sleepFn: (async (ms: number) => {
        slept.push(ms);
      }) as never,
    };
    await fetchAppMetaStatus('1', opts);
    now += 100;
    await fetchAppMetaStatus('2', opts);
    expect(calls.length).toBe(2);
    expect(slept).toEqual([1900]);
    expect(calls[0]).toContain('l=english');
  });

  it('ko locale는 koreana 1요청만 한다', async () => {
    const { fn, calls } = fakeFetch(() => ({
      status: 200,
      body: { 1: { success: true, data: { name: '게임', genres: [{ id: '1', description: '액션' }] } } },
    }));
    const result = await fetchAppMetaStatus('1', {
      cacheDir: mkdtempSync(join(tmpdir(), 'questail-d07-')),
      fetchFn: fn,
      locale: 'ko',
    });
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('l=koreana');
    expect(result.state).toBe('ready');
    expect(result.meta.nameKo).toBe('게임');
    expect(result.meta.genres).toEqual([{ id: '1', name: '액션', nameKo: '액션' }]);
  });

  it('캐시 hit은 API 호출 없이 낸다', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 200, body: envelope('1', 'g') }));
    const dir = mkdtempSync(join(tmpdir(), 'questail-d07-'));
    const first = await fetchAppMetaStatus('1', { cacheDir: dir, fetchFn: fn });
    expect(first.fromCache).toBe(false);
    expect(first.state).toBe('ready');
    const second = await fetchAppMetaStatus('1', { cacheDir: dir, fetchFn: fn });
    expect(second.fromCache).toBe(true);
    expect(second.meta).toEqual(first.meta);
    expect(calls.length).toBe(1);
  });

  it('언어가 다르면 캐시를 따로 쓴다', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 200, body: envelope('1', 'g') }));
    const dir = mkdtempSync(join(tmpdir(), 'questail-d07-'));
    await fetchAppMetaStatus('1', { cacheDir: dir, fetchFn: fn, locale: 'en' });
    await fetchAppMetaStatus('1', { cacheDir: dir, fetchFn: fn, locale: 'ko' });
    expect(calls.length).toBe(2);
  });

  it('취소는 전파한다', async () => {
    const { fn } = fakeFetch(() => ({ status: 200, body: envelope('1', 'g') }));
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      fetchAppMetaStatus('1', {
        cacheDir: mkdtempSync(join(tmpdir(), 'questail-d07-')),
        fetchFn: fn,
        signal: ctrl.signal,
      }),
    ).rejects.toThrow();
  });

  it('일시 실패는 고정하지 않고 폴백한다', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 500, body: {} }));
    const dir = mkdtempSync(join(tmpdir(), 'questail-d07-'));
    const result = await fetchAppMetaStatus('1', { cacheDir: dir, fetchFn: fn });
    expect(result).toEqual({ meta: { appId: '1', genres: [] }, state: 'failed', fromCache: false });
    const again = await fetchAppMetaStatus('1', { cacheDir: dir, fetchFn: fn });
    expect(again.fromCache).toBe(false);
    expect(calls.length).toBe(2);
  });

  it('ko 장르 없으면 null이다', async () => {
    const { fn } = fakeFetch(() => ({
      status: 200,
      body: { 1: { success: true, data: { name: '게임', genres: [] } } },
    }));
    const result = await fetchAppMetaStatus('1', {
      cacheDir: mkdtempSync(join(tmpdir(), 'questail-d07-')),
      fetchFn: fn,
      locale: 'ko',
    });
    expect(result.state).toBe('ready');
    expect(result.meta.genres).toEqual([]);
  });

  it('첫 성공 뒤 429면 셋째를 요청하지 않고 완료 1건을 남긴다', async () => {
    const { fn, calls } = fakeFetch((url: string) => {
      if (url.includes('appids=2')) return { status: 429, body: {} };
      const appId = new URL(url).searchParams.get('appids') ?? '1';
      return { status: 200, body: envelope(appId, 'g') };
    });
    const dir = mkdtempSync(join(tmpdir(), 'questail-d07-'));
    const done: string[] = [];
    await expect(
      fetchAppMetaBatch(['1', '2', '3'], {
        fetchFn: fn,
        cacheDir: dir,
        now: () => 3_000_000,
        onProgress: (_d, _t, appId) => {
          done.push(appId);
        },
      }),
    ).rejects.toBeInstanceOf(AppMetaRateLimitedError);
    expect(done).toEqual(['1']);
    expect(calls.filter((url) => url.includes('appids=2'))).toHaveLength(1);
    expect(calls.some((url) => url.includes('appids=3'))).toBe(false);
  });

  it('bypassCache는 hit을 무시한다', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 200, body: envelope('1', 'g') }));
    const dir = mkdtempSync(join(tmpdir(), 'questail-d07-'));
    await fetchAppMetaStatus('1', { cacheDir: dir, fetchFn: fn });
    const again = await fetchAppMetaStatus('1', { cacheDir: dir, fetchFn: fn, bypassCache: true });
    expect(again.fromCache).toBe(false);
    expect(calls.length).toBe(2);
    expect(readdirSync(dir).length).toBe(1);
  });
});
