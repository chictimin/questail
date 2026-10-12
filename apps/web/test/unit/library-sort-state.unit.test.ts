import { describe, expect, it } from 'vitest';
import type { Prefs } from '../../src/data/viewState.js';
import { flatKeys, t } from '../../src/ui/i18n/index.js';
import type { FilterKey } from '../../src/ui/library/filter.js';
import { SORT_KEYS, SORT_OPTIONS, defaultDirectionOf } from '../../src/ui/library/sort.js';
import { SORT_COMBO_LABELS, SORT_KEY_LABELS, sortComboLabelKey } from '../../src/ui/library/sortLabels.js';
import {
  createPrefsWriteGuard,
  rememberedSort,
  sortAfterDirectionToggle,
  sortAfterKeyChange,
} from '../../src/ui/library/sortState.js';

const FILTERS: FilterKey[] = ['all', 'unrated', 'byRating', 'hidden'];

function prefsWith(filterKey: FilterKey, sortKey: string, direction: string): Prefs {
  return {
    locale: 'ko',
    hidden: [],
    hideShortPlaytime: false,
    sortPerFilter: [{ filterKey, sortKey, direction }],
  } as unknown as Prefs;
}

describe('저장 14조합 × 필터 4 복원', () => {
  for (const filterKey of FILTERS) {
    for (const option of SORT_OPTIONS) {
      it(`${filterKey} · ${option.sortKey}:${option.direction}`, () => {
        const prefs = prefsWith(filterKey, option.sortKey, option.direction);
        expect(rememberedSort(prefs, filterKey)).toEqual(option);
      });
    }
  }
  it('다른 필터의 저장값은 쓰지 않고 그 필터 기본값', () => {
    const prefs = prefsWith('all', 'name', 'desc');
    expect(rememberedSort(prefs, 'byRating')).toEqual({ sortKey: 'ratedAt', direction: 'desc' });
    expect(rememberedSort(prefs, 'unrated')).toEqual({ sortKey: 'playtime', direction: 'desc' });
  });
  it('어휘 밖이면 기본값', () => {
    expect(rememberedSort(prefsWith('all', 'bogus', 'asc'), 'all')).toEqual({ sortKey: 'playtime', direction: 'desc' });
    expect(rememberedSort(prefsWith('all', 'name', 'sideways'), 'all')).toEqual({ sortKey: 'playtime', direction: 'desc' });
    expect(rememberedSort(null, 'all')).toEqual({ sortKey: 'playtime', direction: 'desc' });
  });
});

describe('키 전환·방향 토글', () => {
  it('키 전환은 그 키의 기본 방향(기존 첫 방향)', () => {
    const expected = {
      playtime: 'desc',
      lastPlayed: 'desc',
      rating: 'desc',
      ratedAt: 'desc',
      addedAt: 'desc',
      releaseDate: 'desc',
      name: 'asc',
    } as const;
    for (const key of SORT_KEYS) {
      expect(defaultDirectionOf(key)).toBe(expected[key]);
      expect(sortAfterKeyChange(key)).toEqual({ sortKey: key, direction: expected[key] });
    }
  });
  it('방향 토글은 같은 키 반대 방향, 14조합 모두 이동 가능', () => {
    for (const option of SORT_OPTIONS) {
      const flipped = sortAfterDirectionToggle(option);
      expect(flipped.sortKey).toBe(option.sortKey);
      expect(flipped.direction).not.toBe(option.direction);
      expect(SORT_OPTIONS).toContainEqual(flipped);
    }
  });
});

describe('결과 줄 라벨', () => {
  it('14조합 전부 ko·en 사전에 존재하고 비어 있지 않다', () => {
    const keys = new Set(flatKeys('ko'));
    expect(SORT_OPTIONS).toHaveLength(14);
    for (const option of SORT_OPTIONS) {
      const labelKey = sortComboLabelKey(option);
      expect(keys.has(labelKey)).toBe(true);
      expect(t('ko', labelKey)).not.toBe('');
      expect(t('en', labelKey)).not.toBe('');
    }
    expect(Object.values(SORT_COMBO_LABELS).flatMap((row) => Object.values(row))).toHaveLength(14);
  });
  it('기준 라벨 7개 존재', () => {
    for (const key of SORT_KEYS) {
      expect(t('ko', SORT_KEY_LABELS[key])).not.toBe('');
      expect(t('en', SORT_KEY_LABELS[key])).not.toBe('');
    }
  });
});

describe('load 응답 prefs 시퀀스 가드 (C3)', () => {
  it('load 시작 이후 사용자 PUT이 있으면 그 응답은 stale', () => {
    const guard = createPrefsWriteGuard();
    const token = guard.begin();
    guard.noteWrite();
    expect(guard.isStale(token)).toBe(true);
  });
  it('PUT이 없으면 stale 아님, 이후 새 load는 새 토큰', () => {
    const guard = createPrefsWriteGuard();
    const first = guard.begin();
    expect(guard.isStale(first)).toBe(false);
    guard.noteWrite();
    const second = guard.begin();
    expect(guard.isStale(second)).toBe(false);
    expect(guard.isStale(first)).toBe(true);
  });
});
