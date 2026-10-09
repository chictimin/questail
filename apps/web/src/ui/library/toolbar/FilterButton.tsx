/** U2a 필터 버튼 + 팝오버 — 빠진 게임 토글 + 정렬 라디오 2종. details/summary 네이티브. */
import { SlidersHorizontal } from '@phosphor-icons/react';
import { t, type Locale } from '../../i18n/index.js';
import '../toolbar.css';
import type { SortSpec } from '../sort.js';

const SORT_CHOICES: SortSpec[] = [
  { sortKey: 'playtime', direction: 'desc' },
  { sortKey: 'ratedAt', direction: 'desc' },
];

const SORT_LABELS: Record<string, Parameters<typeof t>[1]> = {
  'playtime:desc': 'library.sortPlaytimeDesc',
  'ratedAt:desc': 'library.sortRatedAtDesc',
};

export function FilterButton({
  locale,
  badgeCount,
  showEnded,
  sortSpec,
  onToggleEnded,
  onSort,
}: {
  locale: Locale;
  /** 켜진 필터 개수 — null이면 뱃지 없음. 정렬은 세지 않는다. */
  badgeCount: number | null;
  showEnded: boolean;
  sortSpec: SortSpec;
  onToggleEnded: () => void;
  onSort: (spec: SortSpec) => void;
}): React.JSX.Element {
  return (
    <details>
      <summary aria-label={t(locale, 'library.filterButton')}>
        <SlidersHorizontal size={16} aria-hidden />
        <span className="filter-text">{t(locale, 'library.filterButton')}</span>
        {badgeCount !== null && <span>{badgeCount}</span>}
      </summary>
      <div>
        <p>{t(locale, 'library.sortTitle')}</p>
        {SORT_CHOICES.map((choice) => {
          const value = `${choice.sortKey}:${choice.direction}`;
          const checked =
            sortSpec.sortKey === choice.sortKey &&
            sortSpec.direction === choice.direction;
          return (
            <label key={value}>
              <input
                type="radio"
                name="sort"
                checked={checked}
                onChange={() => onSort(choice)}
              />
              {t(locale, SORT_LABELS[value] as Parameters<typeof t>[1])}
            </label>
          );
        })}
        <label>
          {t(locale, 'library.showEnded')}
          <input
            type="checkbox"
            checked={showEnded}
            onChange={() => onToggleEnded()}
          />
        </label>
      </div>
    </details>
  );
}
