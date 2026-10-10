/**
 * U3b [2] 수집 상태 화면 조립 — GET status + 폴링(running 2초·정착 시 중지·hidden 정지,
 * 진입·라우트 이동·visible 복귀·focus 1회 reload는 statusContext) + 재수집 resume + 표시값.
 * 수집 실행 자체는 D-06 executor 몫.
 */
import { useCallback, useEffect, useState } from 'react';
import { ArrowClockwise } from '@phosphor-icons/react';
import type { SyncErrorCode } from '@questail/core';
import type { SyncStatusEntry } from '../../data/sync.js';
import { useLocale } from '../i18n/context.js';
import { formatDateTime } from '../../shared/datetime.js';
import { latestFinishedAt, rowViewFor } from '../sync/models.js';
import { appAlertFor } from '../sync/statusMap.js';
import { useSyncStatus } from '../sync/statusContext.js';
import { SyncStatus, type SyncRowModel } from '../sync/SyncStatus.js';

interface AchSettings {
  enabled: boolean;
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`[web] sync 요청 실패: ${response.status}`);
  }
  return (await response.json()) as unknown;
}

export function SyncPage(): React.JSX.Element {
  const { locale, text } = useLocale();
  const { entries, failed: statusFailed, reload } = useSyncStatus();
  const [achEnabled, setAchEnabled] = useState(true);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadAch = useCallback(async () => {
    const achBody = await readJson(await fetch('/api/settings/achievements'));
    setAchEnabled((achBody as AchSettings).enabled);
  }, []);

  useEffect(() => {
    loadAch().catch(() => setFailed(true));
  }, [loadAch]);

  const loadFailed = statusFailed || failed;

  async function retry(source: SyncStatusEntry['source']): Promise<void> {
    try {
      const response = await fetch(`/api/sync/${source}/retry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale }),
      });
      if (!response.ok) {
        throw new Error(`[web] 재수집 실패: ${response.status}`);
      }
      await reload();
    } catch {
      setFailed(true);
    }
  }

  async function collectAll(): Promise<void> {
    try {
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale }),
      });
      if (response.status === 409) {
        setNotice(text('error.SYNC_IN_PROGRESS'));
        return;
      }
      if (!response.ok) {
        throw new Error(`[web] 전체 수집 실패: ${response.status}`);
      }
      setNotice(null);
      await reload();
    } catch {
      setFailed(true);
    }
  }

  const running = entries?.some((entry) => entry.state === 'running') ?? false;

  if (entries === null) {
    return (
      <main data-route="sync">
        <h1>{text('nav.sync')}</h1>
        {loadFailed ? (
          <div role="alert">
            <p>{text('library.loadFailed')}</p>
            <button
              type="button"
              onClick={() => {
                reload().catch(() => setFailed(true));
                loadAch().catch(() => setFailed(true));
              }}
            >
              {text('library.reload')}
            </button>
          </div>
        ) : (
          <div aria-busy={true} />
        )}
      </main>
    );
  }

  const rows: SyncRowModel[] = entries.map((entry) => {
    const view = rowViewFor(entry, achEnabled);
    return {
      source: view.source,
      time: view.time === null ? null : formatDateTime(view.time, locale),
      pill: view.pill,
      body: view.body,
      progress: view.progress,
      retry: view.retry,
      onRetry: view.retry
        ? () => {
            retry(entry.source).catch(() => setFailed(true));
          }
        : undefined,
    };
  });

  const alertEntry = entries.find(
    (entry) => entry.issue?.code === 'AUTH_INVALID_KEY',
  );
  // issue.code는 계약상 SyncErrorCode다. string이라 캐스트한다.
  const alertCode = (alertEntry?.issue?.code ?? null) as SyncErrorCode | null;
  const alert = appAlertFor(alertCode) !== null;
  const finishedAt = latestFinishedAt(entries, achEnabled);

  return (
    <main data-route="sync">
      <div>
        <div>
          <h1>{text('nav.sync')}</h1>
          {finishedAt === null ? null : (
            <p>{text('sync.sub', { t: formatDateTime(finishedAt, locale) })}</p>
          )}
        </div>
        <button
          type="button"
          disabled={running}
          onClick={() => void collectAll()}
        >
          <ArrowClockwise size={16} aria-hidden />
          {text('sync.collectAll')}
        </button>
      </div>
      {notice === null ? null : <p role="status">{notice}</p>}
      {loadFailed ? (
        <div role="alert">
          <p>{text('library.loadFailed')}</p>
        </div>
      ) : null}
      <SyncStatus
        alert={alert}
        rows={rows}
        review={[]}
      />
    </main>
  );
}
