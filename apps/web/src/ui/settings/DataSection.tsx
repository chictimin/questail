/**
 * U5-[3] 설정 데이터 섹션 — 폴더 경로 + 수동 백업 안내 + 자동 백업 목록. 자체 조회.
 * 백업 상한 없음(전건 렌더). 폴더 복사는 U6 export 선례(Range 폴백).
 */
import { useEffect, useRef, useState } from 'react';
import { Archive, Copy } from '@phosphor-icons/react';
import { useLocale } from '../i18n/context.js';
import { formatDateTime } from '../../shared/datetime.js';
import './settings.css';

type Backup = { name: string; size: number; mtime: number };

function formatSize(bytes: number, unit: string): string {
  return `${(bytes / 1048576).toFixed(1)} ${unit}`;
}

export function DataSection(): React.JSX.Element {
  const { locale, text } = useLocale();
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [backups, setBackups] = useState<Backup[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const dirRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const [infoRes, backupsRes] = await Promise.all([
          fetch('/api/settings/info'),
          fetch('/api/settings/backups'),
        ]);
        if (cancelled) {
          return;
        }
        if (infoRes.ok) {
          const info = (await infoRes.json()) as { dataDir?: unknown };
          if (typeof info.dataDir === 'string') {
            setDataDir(info.dataDir);
          }
        }
        if (backupsRes.ok) {
          const body = (await backupsRes.json()) as { backups?: unknown };
          if (Array.isArray(body.backups)) {
            setBackups(
              body.backups.filter(
                (entry): entry is Backup =>
                  typeof entry === 'object' &&
                  entry !== null &&
                  typeof (entry as Backup).name === 'string' &&
                  typeof (entry as Backup).size === 'number' &&
                  typeof (entry as Backup).mtime === 'number',
              ),
            );
          }
        }
      } catch {
        // 조회 실패는 빈 섹션으로 둔다(실패 문구 없음 — 읽기 전용 표시).
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const copy = async (): Promise<void> => {
    if (dataDir === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(dataDir);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      const target = dirRef.current;
      if (target !== null) {
        const range = document.createRange();
        range.selectNodeContents(target);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setCopied(false);
      setCopyFailed(true);
    }
  };

  const dateTime = (mtime: number): string => formatDateTime(mtime, locale);

  return (
    <section aria-labelledby="settings-data-heading">
      <h2 id="settings-data-heading">{text('settings.dataTitle')}</h2>
      <div className="settings-row">
        <span className="settings-label">{text('settings.folderLabel')}</span>
        <div className="settings-body">
          <div>
            <code ref={dirRef}>
              {dataDir ?? '—'}
            </code>
            <button
              type="button"
              onClick={() => {
                void copy();
              }}
            >
              <Copy size={15} aria-hidden />
              {text('export.copyDir')}
            </button>
          </div>
          {copied && <p aria-live="polite">{text('export.copied')}</p>}
          {copyFailed && <p aria-live="polite">{text('export.copyFallback')}</p>}
          <p>
            {text('settings.envBefore')} <code>{'QUESTAIL_DATA_DIR'}</code>
            {text('settings.envAfter')}
          </p>
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-label">{text('settings.backupTitle')}</span>
        <div className="settings-body">
          {backups === null || backups.length === 0 ? (
            <p>{text('settings.backupEmpty')}</p>
          ) : (
            <ul>
              {backups.map((backup) => (
                <li key={backup.name} className="settings-backup-item">
                  <Archive size={15} aria-hidden />{' '}
                  <span className="settings-backup-date">{dateTime(backup.mtime)}</span>{' '}
                  <span>
                    {formatSize(backup.size, text('settings.sizeUnit'))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p>{text('settings.manualBackup')}</p>
        </div>
      </div>
    </section>
  );
}
