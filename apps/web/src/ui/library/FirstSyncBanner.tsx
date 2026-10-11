/**
 * 첫 수집 직후 진행 배너 — info 파스텔 면 + 진행 막대(레퍼런스 ②-b).
 * 클래스 문자열 없이 data 속성·구조 셀렉터로 스타일한다(export.css와 같은 방식, 하드코딩 검사 예외 목록 불변).
 * 2초마다 바뀌므로 live region을 두지 않는다. total이 없으면 부정형 막대.
 */
import { Info } from '@phosphor-icons/react';
import { useLocale } from '../i18n/context.js';
import type { FirstSyncBannerModel } from './bannerState.js';
import './banner.css';

export function FirstSyncBanner({ model }: { model: FirstSyncBannerModel }): React.JSX.Element {
  const { locale, text } = useLocale();
  const format = new Intl.NumberFormat(locale);
  const determinate = model.total !== null && model.total > 0;
  const total = model.total ?? 0;
  const pct = determinate ? Math.min(100, (model.done / total) * 100) : 0;
  return (
    <div data-first-sync-banner>
      <Info size={18} aria-hidden />
      <p>
        {text('library.firstSyncBanner', { n: format.format(model.n) })}
      </p>
      <div data-banner-bar>
        <div
          role="progressbar"
          aria-label={text('library.badgeFilling')}
          aria-valuemin={0}
          aria-valuemax={determinate ? total : undefined}
          aria-valuenow={determinate ? model.done : undefined}
        >
          <div
            data-busy={determinate ? undefined : true}
            style={determinate ? { width: `${pct}%` } : undefined}
          />
        </div>
        {determinate ? (
          <span>
            {format.format(model.done)}/{format.format(total)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
