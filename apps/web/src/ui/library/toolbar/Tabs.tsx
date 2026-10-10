/** U2a 탭 4개 — 개수 없음, 0개 탭 숨김. */
import { t, type Locale } from '../../i18n/index.js';
import type { FilterKey } from '../filter.js';

const TABS: { key: FilterKey; label: Parameters<typeof t>[1] }[] = [
  { key: 'all', label: 'library.filterAll' },
  { key: 'unrated', label: 'library.filterUnrated' },
  { key: 'byRating', label: 'library.filterByRating' },
  { key: 'hidden', label: 'library.filterHidden' },
];

export function ToolbarTabs({
  locale,
  filterKey,
  counts,
  onFilter,
}: {
  locale: Locale;
  filterKey: FilterKey;
  counts: Record<FilterKey, number>;
  onFilter: (key: FilterKey) => void;
}): React.JSX.Element {
  return (
    <div role="tablist" className="lib-tabs">
      {TABS.filter((tab) => counts[tab.key] > 0).map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={filterKey === tab.key}
          className={
            filterKey === tab.key ? 'lib-tab lib-tab--active' : 'lib-tab'
          }
          onClick={() => onFilter(tab.key)}
        >
          {t(locale, tab.label)}
        </button>
      ))}
    </div>
  );
}
