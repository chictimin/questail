import { describe, expect, it } from 'vitest';
import { displayNameOf } from '../../src/shared/displayName.js';
import {
  SORT_OPTIONS,
  compareGames,
  ratedAtOf,
  sortGames,
  type SortableGame,
} from '../../src/ui/library/sort.js';

/** W7 정렬 단위 테스트. 합성 GameFacts로 11조합·2차·맨뒤·P-4를 확인한다. */
function makeGame(overrides?: Partial<SortableGame>): SortableGame {
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

function ids(games: SortableGame[]): string[] {
  return games.map((game) => game.key.externalId);
}

describe('SORT_OPTIONS', () => {
  it('11조합', () => {
    expect(SORT_OPTIONS).toHaveLength(14);
  });
});

describe('값 없음은 방향과 무관하게 맨 뒤', () => {
  it('rating desc·asc', () => {
    const rated = makeGame({ key: { platform: 'steam', externalId: '5' }, latestScore: 8 });
    const unrated = makeGame({ key: { platform: 'steam', externalId: '6' }, latestScore: null });
    expect(ids(sortGames([unrated, rated], 'ko', { sortKey: 'rating', direction: 'desc' }))).toEqual(['5', '6']);
    expect(ids(sortGames([unrated, rated], 'ko', { sortKey: 'rating', direction: 'asc' }))).toEqual(['5', '6']);
  });

  it('lastPlayed null은 맨 뒤', () => {
    const played = makeGame({ key: { platform: 'steam', externalId: '7' }, lastPlayed: 1700100000 });
    const never = makeGame({ key: { platform: 'steam', externalId: '8' }, lastPlayed: null });
    expect(ids(sortGames([never, played], 'ko', { sortKey: 'lastPlayed', direction: 'desc' }))).toEqual(['7', '8']);
  });
});

describe('방향', () => {
  it('playtime 많은 순·적은 순', () => {
    const low = makeGame({ key: { platform: 'steam', externalId: '1' }, confirmedMinutes: 10 });
    const high = makeGame({ key: { platform: 'steam', externalId: '2' }, confirmedMinutes: 90 });
    expect(ids(sortGames([low, high], 'ko', { sortKey: 'playtime', direction: 'desc' }))).toEqual(['2', '1']);
    expect(ids(sortGames([low, high], 'ko', { sortKey: 'playtime', direction: 'asc' }))).toEqual(['1', '2']);
  });

  it('동점 2차 이름 → externalId 숫자 오름', () => {
    const b = makeGame({ key: { platform: 'steam', externalId: '20' }, name: 'Same', confirmedMinutes: 5 });
    const a = makeGame({ key: { platform: 'steam', externalId: '3' }, name: 'Same', confirmedMinutes: 5 });
    expect(ids(sortGames([b, a], 'ko', { sortKey: 'playtime', direction: 'desc' }))).toEqual(['3', '20']);
  });
});

describe('ratedAt', () => {
  it('현재 점수의 최신 at (취소 후 재평가 포함)', () => {
    const facts = makeGame({
      latestScore: 9,
      ratingEvents: [
        { id: 1, before: null, after: 8, at: 1700200000 },
        { id: 2, before: 8, after: null, at: 1700300000 },
        { id: 3, before: null, after: 9, at: 1700400000 },
      ],
    });
    expect(ratedAtOf(facts)).toBe(1700400000);
    expect(ratedAtOf(makeGame({ latestScore: null }))).toBeNull();
  });
});

describe('P-4 이름 규칙', () => {
  it('둘 다 없으면 맨 뒤 + externalId 숫자 오름', () => {
    const nameless200 = makeGame({ key: { platform: 'steam', externalId: '200' }, name: null, titleKo: null });
    const nameless30 = makeGame({ key: { platform: 'steam', externalId: '30' }, name: null, titleKo: null });
    const named = makeGame({ key: { platform: 'steam', externalId: '999' }, name: '가', titleKo: null });
    expect(ids(sortGames([nameless200, named, nameless30], 'ko', { sortKey: 'name', direction: 'asc' }))).toEqual([
      '999',
      '30',
      '200',
    ]);
  });

  it('표시 이름 locale 규칙 + 대체 문구는 정렬 키 아님', () => {
    const game = makeGame({ name: 'Store', titleKo: '한글' });
    expect(displayNameOf(game, 'ko')).toBe('한글');
    expect(displayNameOf(game, 'en')).toBe('Store');
    expect(displayNameOf(makeGame({ name: null, titleKo: '한글' }), 'ko')).toBe('한글');
    expect(displayNameOf(makeGame({ name: null, titleKo: '한글' }), 'en')).toBe('한글');
    expect(displayNameOf(makeGame({ name: null, titleKo: null }), 'ko')).toBeNull();
    expect(displayNameOf(makeGame({ name: null, titleKo: null }), 'en')).toBeNull();
  });

  it('en + titleKo 폴백 게임이 이름 없는 게임보다 앞 (NAME-EN)', () => {
    // en 표시 = name ?? titleKo. 값 없음은 맨 뒤 + externalId 순.
    const onlyKo = makeGame({ key: { platform: 'steam', externalId: '50' }, name: null, titleKo: '한글' });
    const named = makeGame({ key: { platform: 'steam', externalId: '60' }, name: 'Apple', titleKo: null });
    const nameless = makeGame({ key: { platform: 'steam', externalId: '40' }, name: null, titleKo: null });
    expect(
      ids(sortGames([onlyKo, named, nameless], 'en', { sortKey: 'name', direction: 'asc' })),
    ).toEqual(['60', '50', '40']);
  });

  it('en에서는 titleKo 있어도 name으로 정렬', () => {
    const koFirst = makeGame({ key: { platform: 'steam', externalId: '1' }, name: 'Zebra', titleKo: '가' });
    const enFirst = makeGame({ key: { platform: 'steam', externalId: '2' }, name: 'Apple', titleKo: '나' });
    expect(
      ids(sortGames([koFirst, enFirst], 'ko', { sortKey: 'name', direction: 'asc' })),
    ).toEqual(['1', '2']);
    expect(
      ids(sortGames([koFirst, enFirst], 'en', { sortKey: 'name', direction: 'asc' })),
    ).toEqual(['2', '1']);
  });

  it('이름 정렬은 Collator, 입력 배열 불변', () => {
    const games = [
      makeGame({ key: { platform: 'steam', externalId: '1' }, name: '나' }),
      makeGame({ key: { platform: 'steam', externalId: '2' }, name: '가' }),
    ];
    const sorted = sortGames(games, 'ko', { sortKey: 'name', direction: 'asc' });
    expect(ids(sorted)).toEqual(['2', '1']);
    expect(ids(games)).toEqual(['1', '2']);
  });
});

describe('compareGames', () => {
  it('같은 표시 이름이면 platform으로 결정적 순서', () => {
    const a = makeGame({ key: { platform: 'b', externalId: '1' }, name: 'Same', confirmedMinutes: 5 });
    const b = makeGame({ key: { platform: 'a', externalId: '1' }, name: 'Same', confirmedMinutes: 5 });
    expect(compareGames('ko', { sortKey: 'playtime', direction: 'desc' })(a, b)).toBeGreaterThan(0);
  });
});
