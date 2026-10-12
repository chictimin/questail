/** 정렬 라벨 공용 — 결과 줄(조합 라벨)과 정렬 select(키 라벨)가 같은 표를 쓴다. 정렬 로직 없음. */
import type { t } from '../i18n/index.js';
import type { Direction, SortKey, SortSpec } from './sort.js';

type LabelKey = Parameters<typeof t>[1];

/** 조합 라벨 — SORT_OPTIONS 14조합 전부. */
export const SORT_COMBO_LABELS: Record<SortKey, Record<Direction, LabelKey>> = {
  playtime: {
    desc: 'library.sortPlaytimeDesc',
    asc: 'library.sortPlaytimeAsc',
  },
  lastPlayed: {
    desc: 'library.sortLastPlayedDesc',
    asc: 'library.sortLastPlayedAsc',
  },
  rating: {
    desc: 'library.sortRatingDesc',
    asc: 'library.sortRatingAsc',
  },
  ratedAt: {
    desc: 'library.sortRatedAtDesc',
    asc: 'library.sortRatedAtAsc',
  },
  addedAt: {
    desc: 'library.sortAddedAtDesc',
    asc: 'library.sortAddedAtAsc',
  },
  releaseDate: {
    desc: 'library.sortReleaseDateDesc',
    asc: 'library.sortReleaseDateAsc',
  },
  name: {
    asc: 'library.sortNameAsc',
    desc: 'library.sortNameDesc',
  },
};

/** 기준(키) 라벨 — 정렬 select 옵션. */
export const SORT_KEY_LABELS: Record<SortKey, LabelKey> = {
  playtime: 'library.sortKeyPlaytime',
  lastPlayed: 'library.sortKeyLastPlayed',
  rating: 'library.sortKeyRating',
  ratedAt: 'library.sortKeyRatedAt',
  addedAt: 'library.sortKeyAddedAt',
  releaseDate: 'library.sortKeyReleaseDate',
  name: 'library.sortKeyName',
};

export function sortComboLabelKey(spec: SortSpec): LabelKey {
  return SORT_COMBO_LABELS[spec.sortKey][spec.direction];
}
