/** U2a 결과 줄 — 개수 + 기존 count 접미 키 + "· " + 정렬 라벨. 합성 키 없음. */
import { t, type Locale } from '../../i18n/index.js';
import '../toolbar.css';
import type { Direction, SortKey, SortSpec } from '../sort.js';

/** 쌍별 라벨 — FilterButton과 같은 기존 키만 쓴다(키 신설 0). 정렬 로직 없음. */
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

export function ResultLine({
  locale,
  count,
  sortSpec,
}: {
  locale: Locale;
  count: number;
  sortSpec: SortSpec;
}): React.JSX.Element {
  const label = SORT_LABELS[sortSpec.sortKey]?.[sortSpec.direction];
  const formatted = new Intl.NumberFormat(locale).format(count);
  return (
    <p className="result-line">
      <span className="result-count">
        {formatted}
        {t(locale, 'library.count')}
      </span>
      {label !== undefined && (
        <span className="result-sort">
          {'· '}
          {t(locale, label)}
        </span>
      )}
    </p>
  );
}
