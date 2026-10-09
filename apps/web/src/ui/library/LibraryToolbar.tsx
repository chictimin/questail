/** W7 툴바 — 필터 탭·정렬 셀렉트·빠진 게임 체크·별점별 칩. 시각은 만지지 않는다. */
import { t, type Locale } from '../i18n/index.js';
import type { FilterKey } from './filter.js';
import type { Direction, SortKey, SortSpec } from './sort.js';

export interface LibraryToolbarProps {
  locale: Locale;
  filterKey: FilterKey;
  /** 별점별 칩 값 — 저장 단위 1~10, null = 전체 칩. */
  score: number | null;
  counts: Record<FilterKey, number>;
  sortSpec: SortSpec;
  showEnded: boolean;
  onFilter: (key: FilterKey) => void;
  onScore: (score: number | null) => void;
  onSort: (spec: SortSpec) => void;
  onToggleEnded: () => void;
}

const FILTER_KEYS: Record<FilterKey, 'library.filterAll' | 'library.filterUnrated' | 'library.filterByRating' | 'library.filterHidden'> = {
  all: 'library.filterAll',
  unrated: 'library.filterUnrated',
  byRating: 'library.filterByRating',
  hidden: 'library.filterHidden',
};

const FILTER_ORDER: FilterKey[] = ['all', 'unrated', 'byRating', 'hidden'];

/** 11조합 라벨 키. 합성 문자열을 쓰지 않는다(하드코딩 검사). */
const SORT_LABEL_KEYS: {
  [K in SortKey]?: { [D in Direction]?: Parameters<typeof t>[1] };
} = {
  playtime: { desc: 'library.sortPlaytimeDesc', asc: 'library.sortPlaytimeAsc' },
  lastPlayed: { desc: 'library.sortLastPlayedDesc', asc: 'library.sortLastPlayedAsc' },
  rating: { desc: 'library.sortRatingDesc', asc: 'library.sortRatingAsc' },
  ratedAt: { desc: 'library.sortRatedAtDesc' },
  addedAt: { desc: 'library.sortAddedAtDesc' },
  releaseDate: { desc: 'library.sortReleaseDateDesc', asc: 'library.sortReleaseDateAsc' },
  name: { asc: 'library.sortNameAsc' },
};

function sortLabelKey(spec: SortSpec): Parameters<typeof t>[1] {
  const found = SORT_LABEL_KEYS[spec.sortKey]?.[spec.direction];
  if (found === undefined) {
    throw new Error(`[web] 정렬 라벨 없음: ${spec.sortKey}/${spec.direction}`);
  }
  return found;
}

const SORT_ORDER: SortSpec[] = [
  { sortKey: 'playtime', direction: 'desc' },
  { sortKey: 'playtime', direction: 'asc' },
  { sortKey: 'lastPlayed', direction: 'desc' },
  { sortKey: 'lastPlayed', direction: 'asc' },
  { sortKey: 'rating', direction: 'desc' },
  { sortKey: 'rating', direction: 'asc' },
  { sortKey: 'ratedAt', direction: 'desc' },
  { sortKey: 'addedAt', direction: 'desc' },
  { sortKey: 'releaseDate', direction: 'desc' },
  { sortKey: 'releaseDate', direction: 'asc' },
  { sortKey: 'name', direction: 'asc' },
];

/** 칩 값 — 저장 단위 10~1 (별 5.0~0.5). */
const SCORE_CHIPS: number[] = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

function parseSort(value: string): SortSpec | null {
  const [sortKey, direction] = value.split(':');
  const found = SORT_ORDER.find(
    (spec) => spec.sortKey === sortKey && spec.direction === direction,
  );
  return found ?? null;
}

export function LibraryToolbar({
  locale,
  filterKey,
  score,
  counts,
  sortSpec,
  showEnded,
  onFilter,
  onScore,
  onSort,
  onToggleEnded,
}: LibraryToolbarProps): React.JSX.Element {
  const sortValue: `${SortKey}:${Direction}` = `${sortSpec.sortKey}:${sortSpec.direction}`;
  return (
    <div>
      <div role="group">
        {FILTER_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filterKey === key}
            onClick={() => onFilter(key)}
          >
            {t(locale, FILTER_KEYS[key])} {counts[key]}
          </button>
        ))}
      </div>
      <label>
        {t(locale, 'library.showEnded')}
        <input
          type="checkbox"
          checked={showEnded}
          onChange={() => onToggleEnded()}
        />
      </label>
      <label>
        <select
          value={sortValue}
          onChange={(event) => {
            const next = parseSort(event.target.value);
            if (next !== null) onSort(next);
          }}
        >
          {SORT_ORDER.map((spec) => {
            const value = `${spec.sortKey}:${spec.direction}`;
            return (
              <option key={value} value={value}>
                {t(locale, sortLabelKey(spec))}
              </option>
            );
          })}
        </select>
      </label>
      {filterKey === 'byRating' ? (
        <div role="group">
          <button
            type="button"
            aria-pressed={score === null}
            onClick={() => onScore(null)}
          >
            {t(locale, 'library.filterAll')}
          </button>
          {SCORE_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              aria-pressed={score === chip}
              onClick={() => onScore(chip)}
            >
              {chip / 2}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
