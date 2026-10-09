/**
 * U4-P 셸 수집 요약 pill — 게임 정보(info) 소스 progress만 본다(디자인 원문).
 * running: 문구+숫자 · done: 문구+숫자 + check · keyfail(어느 소스든 AUTH_INVALID_KEY):
 * 멈춤 문구 + x · 그 외·total null·run 없음: 숨김. 좁은 폭은 숫자만.
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

export function SummaryPill({
  narrow,
}: {
  narrow?: boolean;
}): React.JSX.Element | null {
  const { locale, text } = useLocale();
  const { entries } = useSyncStatus();
  const model = summaryModelFor(entries);
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
      <Link className="sync-summary" href="/sync" aria-label={text(label, params)}>
        <span aria-hidden>{numbers}</span>
      </Link>
    );
  }
  return (
    <Link className="sync-summary" href="/sync">
      {model.kind === 'run' ? (
        <CircleNotch size={14} color="var(--qt-purple)" aria-hidden />
      ) : (
        <CheckCircle size={14} color="var(--qt-mint)" aria-hidden />
      )}
      {text(label, params)}
    </Link>
  );
}
