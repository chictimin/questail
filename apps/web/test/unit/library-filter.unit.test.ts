import { describe, expect, it } from 'vitest';
import type { GameFacts } from '../../src/data/library.js';
import { filterGames } from '../../src/ui/library/filter.js';
import {
  formatDate,
  formatPlaytime,
  formatRelative,
  formatYear,
  starsOf,
  starsValueText,
} from '../../src/ui/library/format.js';

/** W7 필터·표시 단위 테스트. */
function makeGame(overrides?: Partial<GameFacts>): GameFacts {
  return {
    key: { platform: 'steam', externalId: '100' },
    name: 'Store Name',
    titleKo: null,
    developerRaw: null,
    releaseDate: null,
    releaseDateText: null,
    genres: [],
    coverUrl: null,
    hidden: false,
    libraryAddedAt: null,
    confirmedMinutes: 0,
    lastPlayed: null,
    snapshots: [],
    deltas: [],
    coverage: { firstObservedAt: null, lastObservedAt: null, gapDays: [], isBaseline: false },
    ownership: [],
    wishlist: [],
    tags: [],
    tagStatus: 'not_collected',
    achievements: [],
    achievementState: 'not_collected',
    achievementSummary: null,
    latestScore: null,
    ratingEvents: [],
    syncRunRefs: [],
    ...overrides,
  };
}

describe('filterGames', () => {
  const rated = makeGame({ key: { platform: 'steam', externalId: '1' }, latestScore: 8 });
  const unrated = makeGame({ key: { platform: 'steam', externalId: '2' }, latestScore: null });
  const hiddenRated = makeGame({
    key: { platform: 'steam', externalId: '3' },
    latestScore: 10,
    hidden: true,
  });

  it('all은 숨김 제외', () => {
    expect(filterGames([rated, unrated, hiddenRated], { key: 'all' })).toHaveLength(2);
  });

  it('unrated는 미평가만', () => {
    const out = filterGames([rated, unrated, hiddenRated], { key: 'unrated' });
    expect(out.map((game) => game.key.externalId)).toEqual(['2']);
  });

  it('byRating은 저장값 일치만', () => {
    const out = filterGames([rated, unrated, hiddenRated], { key: 'byRating', score: 8 });
    expect(out.map((game) => game.key.externalId)).toEqual(['1']);
  });

  it('byRating 칩 미선택은 매긴 게임 전부', () => {
    const out = filterGames([rated, unrated, hiddenRated], { key: 'byRating' });
    expect(out.map((game) => game.key.externalId)).toEqual(['1']);
  });

  it('hidden은 숨김만', () => {
    const out = filterGames([rated, unrated, hiddenRated], { key: 'hidden' });
    expect(out.map((game) => game.key.externalId)).toEqual(['3']);
  });

  it('keep은 필터 이탈 유지', () => {
    const out = filterGames([rated, unrated], {
      key: 'unrated',
      keep: ['steam/1'],
    });
    expect(out.map((game) => game.key.externalId).sort()).toEqual(['1', '2']);
  });
});

describe('formatYear', () => {
  it('epoch → UTC 연도, 없으면 원문, 둘 다 없으면 null', () => {
    expect(formatYear(makeGame({ releaseDate: 1704067200 }))).toBe('2024');
    expect(formatYear(makeGame({ releaseDate: null, releaseDateText: 'Q1 2024' }))).toBe('Q1 2024');
    expect(formatYear(makeGame({ releaseDate: null, releaseDateText: null }))).toBeNull();
  });
});

describe('formatPlaytime', () => {
  it('ko·en 단위', () => {
    expect(formatPlaytime(18744, 'ko')).toBe('312.4시간');
    expect(formatPlaytime(18744, 'en')).toBe('312.4h');
  });
});

describe('formatDate·formatRelative', () => {
  it('로케일 날짜 + 상대 시간', () => {
    expect(formatDate(1704067200, 'ko')).toContain('2024');
    expect(formatRelative(1700000000 - 3 * 86400, 1700000000, 'ko')).toContain('3일');
    expect(formatRelative(1700000000 - 3 * 86400, 1700000000, 'en')).toContain('3 days');
  });
});

describe('starsOf·starsValueText', () => {
  it('저장값/별 변환 + aria 문구', () => {
    expect(starsOf(9)).toBe(4.5);
    expect(starsOf(null)).toBeNull();
    expect(starsValueText(9, 'ko')).toBe('4.5점');
    expect(starsValueText(null, 'ko')).toBe('평가 안 함');
    expect(starsValueText(9, 'en')).toBe('4.5 points');
    expect(starsValueText(null, 'en')).toBe('Not rated');
  });
});
