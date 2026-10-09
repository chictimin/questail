/** U2a 툴바 조립 — Tabs + FilterButton + ResultLine + StarFilter(별점별 탭에서만). */
import type { Locale } from '../i18n/index.js';
import type { FilterKey } from './filter.js';
import type { SortSpec } from './sort.js';
import { FilterButton } from './toolbar/FilterButton.js';
import { ResultLine } from './toolbar/ResultLine.js';
import { StarFilter } from './toolbar/StarFilter.js';
import { ToolbarTabs } from './toolbar/Tabs.js';

export interface LibraryToolbarProps {
  locale: Locale;
  filterKey: FilterKey;
  /** 별점별 칩 값 — 저장 단위 1~10, null = 전체. */
  score: number | null;
  counts: Record<FilterKey, number>;
  /** 결과 줄 표시 수(필터 후). */
  resultCount: number;
  sortSpec: SortSpec;
  showEnded: boolean;
  onFilter: (key: FilterKey) => void;
  onScore: (score: number | null) => void;
  onSort: (spec: SortSpec) => void;
  onToggleEnded: () => void;
}

export function LibraryToolbar({
  locale,
  filterKey,
  score,
  counts,
  resultCount,
  sortSpec,
  showEnded,
  onFilter,
  onScore,
  onSort,
  onToggleEnded,
}: LibraryToolbarProps): React.JSX.Element {
  return (
    <div>
      <ToolbarTabs
        locale={locale}
        filterKey={filterKey}
        counts={counts}
        onFilter={onFilter}
      />
      <FilterButton
        locale={locale}
        badgeCount={showEnded ? 1 : null}
        showEnded={showEnded}
        sortSpec={sortSpec}
        onToggleEnded={onToggleEnded}
        onSort={onSort}
      />
      <ResultLine locale={locale} count={resultCount} sortSpec={sortSpec} />
      {filterKey === 'byRating' ? (
        <StarFilter locale={locale} score={score} onScore={onScore} />
      ) : null}
    </div>
  );
}
