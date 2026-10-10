/** U2a 필터 버튼 + 팝오버 — 빠진 게임 토글 + 단시간 가리기 토글 + 정렬 라디오 + 방향 전환. details/summary 네이티브. */
import { Check, SlidersHorizontal } from '@phosphor-icons/react';
import { t, type Locale } from '../../i18n/index.js';
import '../toolbar.css';
import type { Direction, SortKey, SortSpec } from '../sort.js';

const SORT_KEYS: SortKey[] = ['playtime', 'ratedAt'];

const SORT_LABELS: Record<string, Parameters<typeof t>[1]> = {
  'playtime:desc': 'library.sortPlaytimeDesc',
  'playtime:asc': 'library.sortPlaytimeAsc',
  'ratedAt:desc': 'library.sortRatedAtDesc',
  'ratedAt:asc': 'library.sortRatedAtAsc',
};

const DIRECTIONS: Direction[] = ['desc', 'asc'];

const DIRECTION_LABELS: Record<Direction, Parameters<typeof t>[1]> = {
  desc: 'library.sortDesc',
  asc: 'library.sortAsc',
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
          {SORT_KEYS.map((sortKey) => {
            const value = `${sortKey}:${sortSpec.direction}`;
            const checked = sortSpec.sortKey === sortKey;
            return (
              <label
                key={sortKey}
                className={
                  checked ? 'lib-popover-sort lib-popover-sort--on' : 'lib-popover-sort'
                }
              >
                <input
                  type="radio"
                  name="sort"
                  className="lib-radio"
                  checked={checked}
                  onChange={() => onSort({ sortKey, direction: sortSpec.direction })}
                />
                <span className="lib-popover-sort-label">
                  {t(locale, SORT_LABELS[value] as Parameters<typeof t>[1])}
                </span>
                {checked ? <Check size={16} aria-hidden /> : null}
              </label>
            );
          })}
        </div>
        <div className="lib-popover-divider" aria-hidden />
        <span className="lib-popover-heading">{t(locale, 'library.sortDirection')}</span>
        <div className="lib-popover-sorts" role="radiogroup">
          {DIRECTIONS.map((direction) => {
            const checked = sortSpec.direction === direction;
            return (
              <label
                key={direction}
                className={
                  checked ? 'lib-popover-sort lib-popover-sort--on' : 'lib-popover-sort'
                }
              >
                <input
                  type="radio"
                  name="sort-direction"
                  className="lib-radio"
                  checked={checked}
                  onChange={() => onSort({ sortKey: sortSpec.sortKey, direction })}
                />
                <span className="lib-popover-sort-label">
                  {t(locale, DIRECTION_LABELS[direction])}
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
