/** U2a 필터 버튼 + 팝오버 — 빠진 게임 토글 + 단시간 가리기 토글 + 정렬 (sortKey, direction) 쌍 라디오 11항. details/summary 네이티브. */
import { Check, SlidersHorizontal } from '@phosphor-icons/react';
import { t, type Locale } from '../../i18n/index.js';
import '../toolbar.css';
import {
  SORT_OPTIONS,
  type Direction,
  type SortKey,
  type SortSpec,
} from '../sort.js';

/** 쌍별 라벨 — sort.ts SORT_OPTIONS 11조합 전부에 기존 키만 쓴다(키 신설 0). */
const SORT_LABELS: Record<
  SortKey,
  Partial<Record<Direction, Parameters<typeof t>[1]>>
> = {
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
  },
  addedAt: {
    desc: 'library.sortAddedAtDesc',
  },
  releaseDate: {
    desc: 'library.sortReleaseDateDesc',
    asc: 'library.sortReleaseDateAsc',
  },
  name: {
    asc: 'library.sortNameAsc',
  },
};

export function FilterButton({
  locale,
  badgeCount,
  showEnded,
  hideShortPlaytime,
  sortSpec,
  onToggleEnded,
  onToggleHideShortPlaytime,
  onSort,
}: {
  locale: Locale;
  /** 켜진 필터 개수 — null이면 뱃지 없음. 정렬은 세지 않는다. */
  badgeCount: number | null;
  showEnded: boolean;
  hideShortPlaytime: boolean;
  sortSpec: SortSpec;
  onToggleEnded: () => void;
  onToggleHideShortPlaytime: () => void;
  onSort: (spec: SortSpec) => void;
}): React.JSX.Element {
  return (
    <details className="lib-filter">
      <summary className="lib-filter-btn" aria-label={t(locale, 'library.filterButton')}>
        <SlidersHorizontal size={16} aria-hidden />
        <span className="filter-text">{t(locale, 'library.filterButton')}</span>
        {badgeCount !== null && <span className="lib-filter-badge">{badgeCount}</span>}
      </summary>
      <div className="lib-popover" role="dialog" aria-label={t(locale, 'library.filterButton')}>
        <label className="lib-popover-switch">
          <span className="lib-popover-switch-label">{t(locale, 'library.showEnded')}</span>
          <input
            type="checkbox"
            className="lib-switch"
            role="switch"
            aria-checked={showEnded}
            checked={showEnded}
            onChange={() => onToggleEnded()}
          />
        </label>
        <label className="lib-popover-switch">
          <span className="lib-popover-switch-label">{t(locale, 'library.hideShortPlaytime')}</span>
          <input
            type="checkbox"
            className="lib-switch"
            role="switch"
            aria-checked={hideShortPlaytime}
            checked={hideShortPlaytime}
            onChange={() => onToggleHideShortPlaytime()}
          />
        </label>
        <div className="lib-popover-divider" aria-hidden />
        <span className="lib-popover-heading">{t(locale, 'library.sortTitle')}</span>
        <div className="lib-popover-sorts" role="radiogroup">
          {SORT_OPTIONS.map((option) => {
            const checked =
              sortSpec.sortKey === option.sortKey &&
              sortSpec.direction === option.direction;
            const labelKey = SORT_LABELS[option.sortKey][option.direction];
            if (labelKey === undefined) return null;
            return (
              <label
                key={`${option.sortKey}:${option.direction}`}
                className={
                  checked ? 'lib-popover-sort lib-popover-sort--on' : 'lib-popover-sort'
                }
              >
                <input
                  type="radio"
                  name="sort"
                  className="lib-radio"
                  checked={checked}
                  onChange={() =>
                    onSort({
                      sortKey: option.sortKey,
                      direction: option.direction,
                    })
                  }
                />
                <span className="lib-popover-sort-label">
                  {t(locale, labelKey)}
                </span>
                {checked ? <Check size={16} aria-hidden /> : null}
              </label>
            );
          })}
        </div>
      </div>
    </details>
  );
}
