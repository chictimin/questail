/**
 * U4 픽스처 계약 가드 — result.caveats는 계약 v1.0.3 공통 4종만(리캡 섹션 코드
 * 혼입 방지). 축별 caveats는 검사하지 않는다. 이름표 대체 규칙도 함께 둔다.
 */
import { describe, expect, it } from 'vitest';
import {
  fixture8a,
  fixture8c,
  fixture8d,
  fixtureAchOff,
  fixtureAchPart,
} from '../fixtures/tbti.js';
import { buildGameMap, buildGenreMap, lookupName } from '../../src/ui/r15/names.js';

const COMMON = new Set([
  'observation_days',
  'hidden_excluded',
  'outside_steam_missing',
  'server_record_basis',
]);

describe('tbti 픽스처 result.caveats 공통 4종', () => {
  for (const [name, fixture] of [
    ['8a', fixture8a],
    ['8c', fixture8c],
    ['8d', fixture8d],
    ['achOff', fixtureAchOff],
    ['achPart', fixtureAchPart],
  ] as const) {
    it(`${name} — 섹션 코드 없음`, () => {
      for (const caveat of fixture.caveats) {
        expect(COMMON.has(caveat.code)).toBe(true);
      }
    });
  }

  it('8c 보류 규칙 — code ???? + pendingHours', () => {
    expect(fixture8c.code).toBe('????');
    expect(fixture8c.pending).toBe(true);
    expect(fixture8c.pendingHours).toEqual({ have: 192, need: 300 });
  });

  it('8a 비보류 — pendingHours null', () => {
    expect(fixture8a.pendingHours).toBeNull();
  });
});

describe('이름표', () => {
  const facts = [
    {
      key: { platform: 'steam', externalId: '9' },
      name: 'Name',
      titleKo: '이름',
      coverUrl: null,
      genres: [{ genreId: 'action', nameEn: 'Action', nameKo: '액션' }],
    },
  ] as Parameters<typeof buildGameMap>[0];

  it('표에 없으면 externalId로 둔다', () => {
    const map = buildGameMap([], 'ko');
    expect(
      lookupName(map, { platform: 'steam', externalId: 'wilds-2025' }),
    ).toBe('wilds-2025');
  });

  it('장르 표시명은 공용 규칙 — ko는 nameKo, en은 nameEn', () => {
    expect(buildGenreMap(facts, 'ko').get('action')).toBe('액션');
    expect(buildGenreMap(facts, 'en').get('action')).toBe('Action');
  });
});
