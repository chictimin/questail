/** U2a 결과 줄 — 개수 + 기존 count 접미 키 + "· " + 정렬 라벨. 합성 키 없음. */
import { t, type Locale } from '../../i18n/index.js';
import '../toolbar.css';
import type { SortSpec } from '../sort.js';
import { sortComboLabelKey } from '../sortLabels.js';

export function ResultLine({
  locale,
  count,
  sortSpec,
}: {
  locale: Locale;
  count: number;
  sortSpec: SortSpec;
}): React.JSX.Element {
  const label = sortComboLabelKey(sortSpec);
  const formatted = new Intl.NumberFormat(locale).format(count);
  return (
    <p className="result-line">
      <span className="result-count">
        {formatted}
        {t(locale, 'library.count')}
      </span>
      <span className="result-sort">
        {'· '}
        {t(locale, label)}
      </span>
    </p>
  );
}
