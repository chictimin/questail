/**
 * TBTI 보류 카드 8c — 홈 축소판·리캡 07·TBTI 본 화면이 공유한다.
 * 디자인 #8c: white 5% 면 + pink 30% 안쪽 테두리 · 흐린 심볼 72 + ???? · 안내 2줄 · 진행 막대 + `{have} / 5시간`.
 * 칭호 줄은 R1.5 제외. compact(홈)는 패딩만 줄인다.
 * link는 TBTI 화면 밖에서만 — TBTI 화면 자신으로 가는 버튼은 두지 않는다(F-36).
 */
import { Link } from 'wouter';
import { ArrowRight } from '@phosphor-icons/react';
import type { TbtiCardSummary } from '@questail/core';
import { formatPendingHours } from '../../shared/format.js';
import { useLocale } from '../i18n/context.js';
import logoUrl from '../../assets/logo-mark.png';
import './pending.css';

/** 진행률 — TbtiResult.pendingHours 그대로. 요약 출력에는 없어 호출 측이 넘긴다. */
export interface PendingHours {
  have: number;
  need: number;
}

export function TbtiPendingCard({
  summary,
  pendingHours,
  compact,
  link = true,
}: {
  summary: TbtiCardSummary;
  pendingHours: PendingHours | null;
  compact: boolean;
  link?: boolean;
}): React.JSX.Element {
  const { text } = useLocale();
  const pct =
    pendingHours !== null ? Math.min(100, (pendingHours.have / pendingHours.need) * 100) : 0;
  return (
    <section
      className={compact ? 'tbti-pending tbti-pending--compact' : 'tbti-pending'}
      aria-label={text('tbti.myTbti')}
    >
      <div className="tbti-pending-id">
        <img className="tbti-pending-symbol" src={logoUrl} alt="" />
        <span className="tbti-pending-code">{summary.code}</span>
      </div>
      <p className="tbti-pending-lead">{text('tbti.pendLead')}</p>
      <p className="tbti-pending-sub">{text('tbti.pendSub')}</p>
      {pendingHours !== null ? (
        <div className="tbti-pending-prog">
          <span
            className="tbti-pending-track"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={pendingHours.need}
            aria-valuenow={Math.min(pendingHours.have, pendingHours.need)}
            aria-label={text('tbti.pendProg', { have: formatPendingHours(pendingHours.have) })}
          >
            <span className="tbti-pending-fill" style={{ width: `${pct}%` }} />
          </span>
          <span className="tbti-pending-num">
            {text('tbti.pendProg', { have: formatPendingHours(pendingHours.have) })}
          </span>
        </div>
      ) : null}
      {link ? (
        <Link href="/tbti" className="tbti-pending-go">
          {text('tbti.detailLabel')}
          <ArrowRight size={16} aria-hidden />
        </Link>
      ) : null}
    </section>
  );
}
