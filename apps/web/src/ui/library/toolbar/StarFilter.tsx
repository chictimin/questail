/** U2a 별점별 탭 안 별 위젯 필터 — Stars 재사용. 클릭 확정·재클릭 해제·전체 보기. */
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
    <div>
      <p>{t(locale, 'library.sfLabel')}</p>
      <Stars
        value={score}
        locale={locale}
        onCommit={(stars) => onScore(stars === null ? null : stars * 2)}
      />
      <button type="button" onClick={() => onScore(null)}>
        {t(locale, 'library.sfClear')}
      </button>
    </div>
  );
}
