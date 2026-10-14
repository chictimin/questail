/**
 * U4-P 셸 수집 요약 pill — 게임 정보(info) 소스 progress만 본다(디자인 원문).
 * running: 문구+숫자 · keyfail(어느 소스든 AUTH_INVALID_KEY): 멈춤 문구 + x ·
 * 완료(running·fail 아님)이고 마지막 수집 시각이 있으면: check-circle mint + 날짜 수집(R1.5 셸 Na, F-37 —
 * 좁은 폭은 날짜 숫자만) · 그 외(run 없음): 숨김.
 */
import { CheckCircle, CircleNotch, XCircle } from '@phosphor-icons/react';
import type { SyncErrorCode } from '@questail/core';
import { Link } from 'wouter';
import { useLocale } from '../i18n/context.js';
import { appAlertFor } from '../sync/statusMap.js';
import { useSyncStatus } from '../sync/statusContext.js';
import type { SyncStatusEntry } from '../../data/sync.js';

export type SummaryModel =
  | { kind: 'run'; done: number; total: number }
  | { kind: 'done'; done: number; total: number }
  | { kind: 'fail' }
  | null;

/** 순수 판정 — 단위 테스트 대상. */
export function summaryModelFor(entries: SyncStatusEntry[] | null): SummaryModel {
  if (entries === null) {
    return null;
  }
  if (
    entries.some(
      (entry) =>
        appAlertFor((entry.issue?.code ?? null) as SyncErrorCode | null) !== null,
    )
  ) {
    return { kind: 'fail' };
  }
  const meta = entries.find((entry) => entry.source === 'meta');
  if (meta === undefined || meta.progress.total === null) {
    return null;
  }
  if (meta.state === 'running') {
    return { kind: 'run', done: meta.progress.done, total: meta.progress.total };
  }
  if (meta.state === 'ok') {
    return { kind: 'done', done: meta.progress.done, total: meta.progress.total };
  }
  return null;
}

/** 마지막 수집 시각 — 소스들 lastFinishedAt 최댓값. 없으면 null. */
export function lastCollectedAt(entries: SyncStatusEntry[] | null): number | null {
  const times = (entries ?? [])
    .map((entry) => entry.lastFinishedAt)
    .filter((value): value is number => value !== null);
  return times.length === 0 ? null : Math.max(...times);
}

export function SummaryPill({
  narrow,
}: {
  narrow?: boolean;
}): React.JSX.Element | null {
  const { locale, text } = useLocale();
  const { entries } = useSyncStatus();
  const model = summaryModelFor(entries);
  const lastAt = lastCollectedAt(entries);
  if ((model === null || model.kind === 'done') && lastAt !== null) {
    const date = new Date(lastAt * 1000);
    const wide = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(date);
    const short = new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' })
      .formatToParts(date)
      .filter((part) => part.type === 'month' || part.type === 'day')
      .map((part) => part.value)
      .join('.');
    const label = text('shell.summaryAt', { date: wide });
    return narrow === true ? (
      <Link className="sync-summary sync-summary--narrow" href="/sync" aria-label={label}>
        <span aria-hidden>{short}</span>
      </Link>
    ) : (
      <Link className="sync-summary" href="/sync">
        <CheckCircle size={14} color="var(--qt-mint)" aria-hidden />
        {label}
      </Link>
    );
  }
  if (model === null) {
    return <span className="sync-summary" />;
  }
  if (model.kind === 'fail') {
    return (
      <Link className="sync-summary" href="/sync">
        <XCircle size={14} color="var(--qt-red)" aria-hidden />
        {text('shell.summaryFail')}
      </Link>
    );
  }
  const format = new Intl.NumberFormat(locale);
  const params = {
    done: format.format(model.done),
    total: format.format(model.total),
  };
  const label = model.kind === 'run' ? 'shell.summary' : 'shell.summaryDone';
  const numbers = `${params.done}/${params.total}`;
  if (narrow === true) {
    return (
      <Link
        className="sync-summary sync-summary--narrow"
        href="/sync"
        aria-label={text(label, params)}
      >
        <span aria-hidden>{numbers}</span>
      </Link>
    );
  }
  return (
    <Link className="sync-summary" href="/sync">
      {model.kind === 'run' ? (
        <CircleNotch
          size={14}
          color="var(--qt-purple)"
          className="qt-spin"
          aria-hidden
        />
      ) : (
        <CheckCircle size={14} color="var(--qt-mint)" aria-hidden />
      )}
      {text(label, params)}
    </Link>
  );
}
