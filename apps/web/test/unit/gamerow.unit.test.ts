import { describe, expect, it } from 'vitest';
import type { GameFacts } from '../../src/data/library.js';
import { t } from '../../src/ui/i18n/index.js';
import {
  STEAM_STORE_URL,
  displayGameName,
  rowBadges,
} from '../../src/ui/library/GameRow.js';

/** W7 행 순수 로직 단위 테스트. 뱃지·표시 이름·스토어 상수를 확인한다. */
type RowGame = Omit<GameFacts, 'name'> & { name: string | null };

function makeGame(overrides?: Partial<RowGame>): RowGame {
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
    ownership: [{ origin: 'observed', startedAt: 1700000000, ended: false, endedAt: null, isBaseline: false, syncRunId: null }],
    wishlist: [],
    tags: [],
    tagStatus: 'not_collected',
    achievements: [],
    achievementState: 'not_collected',
    latestScore: null,
    ratingEvents: [],
    syncRunRefs: [],
    ...overrides,
  };
}

describe('rowBadges', () => {
  it('미평가·빠짐·미보충', () => {
    expect(rowBadges(makeGame())).toEqual(['unrated', 'filling']);
    expect(
      rowBadges(
        makeGame({
          latestScore: 8,
          coverUrl: 'https://example.com/cover.jpg',
          genres: [{ genreId: 'action', nameEn: 'Action', nameKo: null }],
        }),
      ),
    ).toEqual([]);
    expect(
      rowBadges(
        makeGame({
          latestScore: 8,
          coverUrl: 'https://example.com/cover.jpg',
          genres: [{ genreId: 'action', nameEn: 'Action', nameKo: null }],
          ownership: [{ origin: 'observed', startedAt: 1700000000, ended: true, endedAt: 1700100000, isBaseline: false, syncRunId: null }],
        }),
      ),
    ).toEqual(['missing']);
  });
});

describe('displayGameName', () => {
  it('ko: titleKo → name → game.untitled', () => {
    expect(displayGameName(makeGame({ name: 'Store', titleKo: '한글' }), 'ko')).toBe('한글');
    expect(displayGameName(makeGame({ name: 'Store', titleKo: null }), 'ko')).toBe('Store');
    expect(displayGameName(makeGame({ name: null, titleKo: null }), 'ko')).toBe(
      t('ko', 'game.untitled', { externalId: '100' }),
    );
  });

  it('en: name → game.untitled(titleKo 무시)', () => {
    expect(displayGameName(makeGame({ name: 'Store', titleKo: '한글' }), 'en')).toBe('Store');
    expect(displayGameName(makeGame({ name: null, titleKo: '한글' }), 'en')).toBe(
      t('en', 'game.untitled', { externalId: '100' }),
    );
  });

  it('en + name 없음 + titleKo만 있음 → 값 없음 그룹(P-9·PM #74479 확정)', () => {
    // en 표시 = name만, 없으면 untitled(P-4도 현재 locale 표시 이름 기준으로 정리).
    const onlyKo = makeGame({ key: { platform: 'steam', externalId: '50' }, name: null, titleKo: '한글' });
    const named = makeGame({ key: { platform: 'steam', externalId: '60' }, name: 'Apple', titleKo: null });
    expect(displayGameName(onlyKo, 'en')).toBe(
      t('en', 'game.untitled', { externalId: '50' }),
    );
  });
});

describe('STEAM_STORE_URL', () => {
  it('ui 상수', () => {
    expect(STEAM_STORE_URL).toBe('https://store.steampowered.com/app');
  });
});
