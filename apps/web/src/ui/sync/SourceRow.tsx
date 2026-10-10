/** U3a 수집 상태 소스 행 — 이름·시각 / 막대+수치 또는 원인 / pill+재수집 자리. */
import { ArrowClockwise, ArrowRight, Warning, XCircle } from '@phosphor-icons/react';
import { Link } from 'wouter';
import { useLocale } from '../i18n/context.js';
import { Pill } from './Pill.js';
import type { RowBody, SyncPill } from './statusMap.js';
import './sync.css';

export interface SourceRowProps {
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  nameKey: `sync.${string}`;
  /** 마지막 확정 시각(ISO 표기). null이면 '—'. */
  time: string | null;
  pill: SyncPill;
  body: RowBody;
  /** 진행 수치(0~100·표시 문자열). body가 progress일 때만. */
  progress?: { pct: number; label: string };
  retry: boolean;
  /** U3b 배선. 없으면 재수집 버튼은 disabled 표시만. */
  onRetry?: () => void;
}

function CauseIcon({ error }: { error: boolean }): React.JSX.Element {
  const Icon = error ? XCircle : Warning;
  return <Icon size={15} className="sync-cause-icon" aria-hidden />;
}

export function SourceRow(props: SourceRowProps): React.JSX.Element {
  const { text } = useLocale();
  const Icon = props.icon;
  return (
    <div className="sync-row">
      <div className="sync-row-id">
        <span className="sync-iconbox">
          <Icon size={16} aria-hidden />
        </span>
        <div>
          <div className="sync-row-name">{text(props.nameKey)}</div>
          {props.time === null ? null : (
            <div className="sync-row-time">{props.time}</div>
          )}
        </div>
      </div>
      <div className="sync-row-body">
        {props.body.kind === 'progress' && props.progress !== undefined ? (
          <div className="sync-bar">
            <div
              role="progressbar"
              aria-label={text(props.nameKey)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(props.progress.pct)}
              className="sync-bar-track"
            >
              <div
                className={`sync-bar-fill${props.pill === 'hold' ? ' sync-bar-fill--hold' : ''}`}
                style={{ width: `${props.progress.pct}%` }}
              />
            </div>
            <span className="sync-bar-num">{props.progress.label}</span>
          </div>
        ) : null}
        {props.body.kind === 'cause' && props.pill === 'done' ? (
          <span>{text(props.body.key, props.body.params)}</span>
        ) : null}
        {props.body.kind === 'cause' && props.pill !== 'done' ? (
          <div
            className={`sync-cause${props.pill === 'fail' ? ' sync-cause--error' : ' sync-cause--warn'}`}
          >
            <CauseIcon error={props.pill === 'fail'} />
            <span>{text(props.body.key, props.body.params)}</span>
            {props.body.link === undefined ? null : (
              <a
                href={props.body.link.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {text(props.body.link.label)}
              </a>
            )}
          </div>
        ) : null}
      </div>
      <div className="sync-tail">
        {props.retry ? (
          <button
            type="button"
            disabled={props.onRetry === undefined}
            onClick={props.onRetry}
            className="sync-retry"
          >
            <ArrowClockwise size={14} aria-hidden />
            {text('sync.retry')}
          </button>
        ) : (
          <Pill pill={props.pill} />
        )}
      </div>
    </div>
  );
}

export function KeyAlert(): React.JSX.Element {
  const { text } = useLocale();
  return (
    <div role="alert" className="sync-notice">
      <XCircle size={18} className="sync-notice-icon" aria-hidden />
      <div className="sync-notice-body">
        <b className="sync-notice-word">{text('sync.noticeError')}</b>
        {text('sync.alertKey')}
      </div>
      <Link href="/settings" className="sync-notice-action">
        {text('sync.alertKeyAction')}
        <ArrowRight size={14} aria-hidden />
      </Link>
    </div>
  );
}
