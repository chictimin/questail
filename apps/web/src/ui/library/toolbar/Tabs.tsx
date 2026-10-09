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
    <div role="group">
      {TABS.filter((tab) => counts[tab.key] > 0).map((tab) => (
        <button
          key={tab.key}
          type="button"
          aria-pressed={filterKey === tab.key}
          onClick={() => onFilter(tab.key)}
        >
          {t(locale, tab.label)}
        </button>
      ))}
    </div>
  );
}
