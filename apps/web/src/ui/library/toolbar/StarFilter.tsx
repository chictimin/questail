/** U2a 별점별 탭 안 별 필터 — Stars 재사용. 클릭 확정·재클릭 해제·전체 보기. */
import { X } from '@phosphor-icons/react';
import { t, type Locale } from '../../i18n/index.js';
import { Stars } from '../Stars.js';

export function StarFilter({
  locale,
  score,
  onScore,
}: {
  locale: Locale;
  /** 저장 단위 1~10, null = 전체. */
  score: number | null;
  onScore: (score: number | null) => void;
}): React.JSX.Element {
  return (
    <div className="star-filter">
      <span className="star-filter-label">{t(locale, 'library.sfLabel')}</span>
      <Stars
        value={score}
        locale={locale}
        showValue
        onCommit={(stars) => onScore(stars === null ? null : stars * 2)}
      />
      <span className="star-filter-spacer" aria-hidden />
      {score === null ? null : (
        <button
          type="button"
          className="star-filter-clear"
          aria-label={t(locale, 'library.sfClear')}
          title={t(locale, 'library.sfClear')}
          onClick={() => onScore(null)}
        >
          <X size={14} aria-hidden />
          <span className="filter-text">{t(locale, 'library.sfClear')}</span>
        </button>
      )}
    </div>
  );
}
