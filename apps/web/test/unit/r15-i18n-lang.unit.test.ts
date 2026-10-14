import { describe, expect, it } from 'vitest';
import type { LibraryRecap } from '@questail/core';
import { renderRecapText } from '../../src/data/recapText.js';
import {
  genreDisplayName,
  genreExportNames,
  hasEnglishGenreName,
} from '../../src/shared/genres.js';
import { en } from '../../src/ui/i18n/en.js';
import { ko } from '../../src/ui/i18n/ko.js';
import { buildGameMap, lookupName } from '../../src/ui/r15/names.js';

/**
 * W2 i18n·언어 회귀(F-08·F-09·F-34). 캡틴 사본처럼 ko로만 수집해
 * genre_name_en이 전부 NULL인 사용자가 기준이다.
 */
describe('장르 — Steam ID 고정표(nameEn 없을 때만)', () => {
  it('en: nameEn 없음 + 확인된 ID → 고정표 영문', () => {
    expect(genreDisplayName({ genreId: '1', nameKo: '액션', nameEn: null }, 'en')).toBe('Action');
    expect(genreDisplayName({ genreId: '29', nameKo: '대규모 멀티플레이어', nameEn: null }, 'en')).toBe(
      'Massively Multiplayer',
    );
  });

  it('en: 표에 없는 ID → Other genre(한국어 0)', () => {
    expect(genreDisplayName({ genreId: '9999', nameKo: '무언가', nameEn: null }, 'en')).toBe('Other genre');
  });

  it('en: nameEn이 있으면 표보다 우선', () => {
    expect(genreDisplayName({ genreId: '1', nameKo: '액션', nameEn: 'Action!' }, 'en')).toBe('Action!');
  });

  it('ko: nameKo 그대로', () => {
    expect(genreDisplayName({ genreId: '1', nameKo: '액션', nameEn: null }, 'ko')).toBe('액션');
  });

  it('내보내기: nameEn 없으면 고정표 영문', () => {
    expect(genreExportNames([{ genreId: '25', nameKo: '어드벤처', nameEn: null }])).toEqual(['Adventure']);
  });

  it('hasEnglishGenreName', () => {
    expect(hasEnglishGenreName({ genreId: '23', nameKo: '인디', nameEn: null })).toBe(true);
    expect(hasEnglishGenreName({ genreId: '9999', nameKo: '무언가', nameEn: null })).toBe(false);
  });
});

describe('게임명 — R1 displayNameOf와 같은 규칙', () => {
  const facts = [
    {
      key: { platform: 'steam', externalId: '9' },
      name: 'Name',
      titleKo: '이름',
      coverUrl: null,
      genres: [],
    },
  ] as unknown as Parameters<typeof buildGameMap>[0];

  it('ko titleKo, en name', () => {
    expect(lookupName(buildGameMap(facts, 'ko'), { platform: 'steam', externalId: '9' })).toBe('이름');
    expect(lookupName(buildGameMap(facts, 'en'), { platform: 'steam', externalId: '9' })).toBe('Name');
  });
});

const RECAP = {
  basis: { observedDays: 2, rangeStart: null, rangeEnd: null, firstObservedAt: 1700000000 },
  s01: { caveats: [], totalMinutes: 600, top5: [] },
  s02: {
    caveats: [],
    knownGames: 3,
    bars: [
      { genreId: '23', games: 3 },
      { genreId: '2', games: 2 },
    ],
  },
  s03: { caveats: [], owned: 3, played: 3, buckets: [], unplayedKeys: [], missingKeys: [] },
  s04: { caveats: [], ratedCount: 0, mean: null, dist10: [], high: [], low: [] },
  s05: { caveats: [], bands: [] },
  s06: { caveats: [], years: [], comparePrevYear: false },
  tbti: {
    code: '????',
    pending: true,
    letters: ['?', '?', '?', '?'],
    mini: [],
  },
} as unknown as LibraryRecap;

const KO_ONLY = new Map([
  ['23', { genreId: '23', nameKo: '인디', nameEn: null }],
  ['2', { genreId: '2', nameKo: '전략', nameEn: null }],
]);

describe('리캡 텍스트 장르 줄', () => {
  it('ko: 받침 있는 끝 장르는 "이"(F-34)', () => {
    expect(renderRecapText(RECAP, 'ko', undefined, KO_ONLY)).toContain('- 장르: 인디 · 전략이 많음');
  });

  it('ko: 받침 없는 끝 장르는 "가"', () => {
    const reversed = { ...RECAP, s02: { ...RECAP.s02, bars: [...RECAP.s02.bars].reverse() } };
    expect(renderRecapText(reversed, 'ko', undefined, KO_ONLY)).toContain('- 장르: 전략 · 인디가 많음');
  });

  it('en: ko만 수집한 사용자도 장르 줄이 영문으로 남는다', () => {
    const text = renderRecapText(RECAP, 'en', undefined, KO_ONLY);
    expect(text).toContain('- Top genres: Indie · Strategy');
    expect(text).not.toMatch(/[가-힣]/);
  });
});

describe('금지 문구 — 「경계」·「양쪽에 걸쳐요」 0(F-08)', () => {
  it('ko 사전 값 전체', () => {
    const all = JSON.stringify(ko);
    expect(all).not.toContain('경계');
    expect(all).not.toContain('양쪽에 걸쳐');
  });

  it('en 보류 사유에 line 표현 없음', () => {
    expect(en.tbti.heldCross).not.toMatch(/line/i);
  });
});
