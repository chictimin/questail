import { describe, expect, it } from 'vitest';
import { extractVanityName, parseSteamIdInput } from '../../src/ui/steamId.js';

describe('parseSteamIdInput', () => {
  it('숫자만 → 전송', () => {
    expect(parseSteamIdInput('76561198000000001')).toEqual({
      blocked: false,
      steamId: '76561198000000001',
      vanity: null,
    });
  });

  it('앞뒤 공백 제거', () => {
    expect(parseSteamIdInput('  12345  ')).toEqual({
      blocked: false,
      steamId: '12345',
      vanity: null,
    });
  });

  it('/profiles/ 숫자 추출', () => {
    expect(
      parseSteamIdInput('https://steamcommunity.com/profiles/76561197960287930'),
    ).toEqual({ blocked: false, steamId: '76561197960287930', vanity: null });
  });

  it('/id/ 커스텀 → 차단(요청 없음) + vanity', () => {
    expect(parseSteamIdInput('steamcommunity.com/id/yourname')).toEqual({
      blocked: true,
      steamId: '',
      vanity: 'yourname',
    });
  });

  it('그 외 → 원문 전송(서버 판정)', () => {
    expect(parseSteamIdInput('???')).toEqual({
      blocked: false,
      steamId: '???',
      vanity: null,
    });
  });
});

describe('extractVanityName', () => {
  it('/id/ 단일 이름 추출', () => {
    expect(extractVanityName('steamcommunity.com/id/yourname')).toBe('yourname');
    expect(extractVanityName('https://steamcommunity.com/id/yourname/')).toBe(
      'yourname',
    );
  });

  it('변형 없음 — 대소문자 유지', () => {
    expect(extractVanityName('steamcommunity.com/id/YourName')).toBe('YourName');
  });

  it('빈 값·형태 없음 → null', () => {
    expect(extractVanityName('steamcommunity.com/id/')).toBeNull();
    expect(extractVanityName('76561198000000001')).toBeNull();
  });
});
