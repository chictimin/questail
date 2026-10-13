/**
 * TBTI 보류 카드 8c — 홈 축소판·리캡 07·TBTI 본 화면이 공유한다.
 * white 5% 면 + pink 30% 테두리 · 흐린 심볼 · ???? · 안내 2줄 · 진행 막대.
 * compact면 안내 두 번째 줄을 뺀다.
 */
import { Link } from 'wouter';
import type { TbtiCardSummary } from '@questail/core';
import { useLocale } from '../i18n/context.js';
import logoUrl from '../../assets/logo-mark.png';
import './tbti.css';

/** 진행률 — TbtiResult.pendingHours 그대로. 요약 출력에는 없어 호출 측이 넘긴다. */
export interface PendingHours {
  have: number;
  need: number;
}

export function TbtiPendingCard({
  summary,
  pendingHours,
  compact,
}: {
  summary: TbtiCardSummary;
  pendingHours: PendingHours | null;
  compact: boolean;
}): React.JSX.Element {
  const { text } = useLocale();
  const haveHours =
    pendingHours !== null ? (pendingHours.have / 60).toFixed(1) : null;
  return (
    <section
      className="tbti-pending"
      aria-label={text('tbti.myTbti')}
    >
      <img className="tbti-pending-symbol" src={logoUrl} alt="" />
      <p className="tbti-pending-code">{summary.code}</p>
      <p className="tbti-pending-lead">{text('tbti.pendLead')}</p>
      {compact ? null : <p className="tbti-pending-sub">{text('tbti.pendSub')}</p>}
      {haveHours !== null && pendingHours !== null ? (
        <p className="tbti-pending-prog">
          {text('tbti.pendProg', { have: haveHours })}
        </p>
      ) : null}
      <div className="tbti-pending-track" aria-hidden="true">
        <span
          className="tbti-pending-fill"
          style={{
            width:
              pendingHours !== null
                ? `${Math.min(100, (pendingHours.have / pendingHours.need) * 100)}%`
                : '0%',
          }}
        />
      </div>
      <Link href="/tbti" className="tbti-pending-go">
        {text('tbti.detail')}
      </Link>
    </section>
  );
}
