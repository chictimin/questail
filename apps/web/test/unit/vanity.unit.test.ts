import { describe, expect, it } from 'vitest';
import { resolveVanityName } from '@questail/core';

/**
 * D-P7 vanity 해석 테스트. 가짜 fetch·합성 이름만 쓴다. 실호출 없음.
 */
const KEY = '0123456789abcdef0123456789abcdef';

function fakeFetch(body: unknown, status = 200) {
  return (async () => ({ status, json: async () => body })) as never;
}

describe('resolveVanityName', () => {
  it('성공하면 SteamID64를 낸다', async () => {
    let seen = '';
    const result = await resolveVanityName({
      vanity: '합성유저',
      keyText: KEY,
      baseUrl: 'http://127.0.0.1:8080/',
      fetchFn: (async (url: string) => {
        seen = url;
        return { status: 200, json: async () => ({ response: { success: 1, steamid: '76561197960287930' } }) };
      }) as never,
    });
    expect(result).toEqual({ ok: true, steamId: '76561197960287930' });
    expect(seen.startsWith('http://127.0.0.1:8080/ISteamUser/ResolveVanityURL/v0001/')).toBe(true);
    expect(seen).toContain('url_type=1');
  });

  it('빈 vanity는 거부한다', async () => {
    expect(await resolveVanityName({ vanity: '  ', keyText: KEY, fetchFn: fakeFetch({}) })).toEqual({
      ok: false,
      code: 'PAYLOAD_CORRUPT',
      params: {},
    });
  });

  it('알려진 0건은 not_found다', async () => {
    expect(
      await resolveVanityName({
        vanity: '없는유저',
        keyText: KEY,
        fetchFn: fakeFetch({ response: { success: 42 } }),
      }),
    ).toEqual({ ok: false, code: 'AUTH_ID_MISMATCH', params: { reason: 'not_found' } });
  });

  it('success 그 외는 깨짐이다', async () => {
    expect(
      await resolveVanityName({
        vanity: '합성유저',
        keyText: KEY,
        fetchFn: fakeFetch({ response: { success: 7 } }),
      }),
    ).toEqual({ ok: false, code: 'PAYLOAD_CORRUPT', params: {} });
  });

  it('401은 키 거부다', async () => {
    expect(
      await resolveVanityName({ vanity: '합성유저', keyText: KEY, fetchFn: fakeFetch({}, 401) }),
    ).toEqual({ ok: false, code: 'AUTH_INVALID_KEY', params: { reason: 'rejected' } });
  });

  it('응답 없는 가짜도 10초 안에 끝나고 재시도·누출이 없다', async () => {
    let calls = 0;
    const started = Date.now();
    const result = await resolveVanityName({
      vanity: '합성유저',
      keyText: KEY,
      fetchFn: (async () => {
        calls += 1;
        await new Promise(() => {
          /* 영원히 안 끝난다. abort도 무시한다 */
        });
      }) as never,
    });
    expect(Date.now() - started).toBeLessThan(11_000);
    expect(calls).toBe(1);
    expect(result).toEqual({ ok: false, code: 'NETWORK', params: { reason: 'timeout' } });
    expect(JSON.stringify(result)).not.toContain(KEY);
  }, 15_000);

  it('비루프백 baseUrl은 거부한다', async () => {
    expect(
      await resolveVanityName({
        vanity: '합성유저',
        keyText: KEY,
        baseUrl: 'https://example.com/',
        fetchFn: fakeFetch({}),
      }),
    ).toEqual({ ok: false, code: 'NETWORK', params: { reason: 'upstream' } });
  });
});
