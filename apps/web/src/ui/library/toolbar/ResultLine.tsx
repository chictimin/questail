/** U2a 결과 줄 — 개수 + 기존 count 접미 키 + "· " + 정렬 라벨. 합성 키 없음. */
import { t, type Locale } from '../../i18n/index.js';
import '../toolbar.css';
import type { SortSpec } from '../sort.js';

const SORT_LABELS: Record<string, Parameters<typeof t>[1]> = {
  'playtime:desc': 'library.sortPlaytimeDesc',
  'ratedAt:desc': 'library.sortRatedAtDesc',
};

export function ResultLine({
  locale,
  count,
  sortSpec,
}: {
  locale: Locale;
  count: number;
  sortSpec: SortSpec;
}): React.JSX.Element {
  const key = `${sortSpec.sortKey}:${sortSpec.direction}`;
  const label = SORT_LABELS[key];
  const formatted = new Intl.NumberFormat(locale).format(count);
  return (
    <p className="result-line">
      <span className="result-count">
        {formatted}
        {t(locale, 'library.count')}
      </span>
      {label !== undefined && (
        <span className="result-sort">
          {'·'}
          {t(locale, label)}
        </span>
      )}
    </p>
  );
}
