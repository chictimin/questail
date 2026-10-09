import { describe, expect, it } from 'vitest';
import { resolveSteamApiBaseUrl, STEAM_API_BASE_ENV } from '../../src/server/deps.js';

/** W-P6 [1] env 3분기 기동 동작. 값·키·경로 반향 없음. */
function envWith(value: string | undefined): NodeJS.ProcessEnv {
  if (value === undefined) return {};
  return { [STEAM_API_BASE_ENV]: value };
}

describe('resolveSteamApiBaseUrl', () => {
  it('없음 → undefined (기존 동작)', () => {
    expect(resolveSteamApiBaseUrl(envWith(undefined))).toBeUndefined();
    expect(resolveSteamApiBaseUrl(envWith('   '))).toBeUndefined();
  });

  it('정상 루프백 → 정규화값', () => {
    expect(resolveSteamApiBaseUrl(envWith('http://127.0.0.1:9/'))).toBe(
      'http://127.0.0.1:9',
    );
    expect(resolveSteamApiBaseUrl(envWith('http://localhost:43111/steam/'))).toBe(
      'http://localhost:43111/steam',
    );
  });

  it('거부 → throw, 메시지에 값·키·경로 없음', () => {
    const badValues = [
      'https://example.com/',
      'notaurl',
      'ftp://127.0.0.1/',
      'http://user@127.0.0.1/',
    ];
    for (const bad of badValues) {
      let message = '';
      try {
        resolveSteamApiBaseUrl(envWith(bad));
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).not.toBe('');
      expect(message).not.toContain(bad.trim());
      expect(message).not.toMatch(/[0-9a-f]{32}/i);
    }
    expect(() => resolveSteamApiBaseUrl(envWith('https://example.com/'))).toThrow();
  });
});
