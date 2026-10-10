/**
 * U5-[2] 설정 연결 섹션 — SteamID 고정 표시 + 키 상태. 자체 조회(Achievements 패턴).
 * 키 교체는 /connect 이동(reEnter가 거기 있음). d_more 링크는 목적지 미확인으로 제외.
 */
import { useEffect, useRef, useState } from 'react';
import { CheckCircle, Key, LockSimple, Prohibit } from '@phosphor-icons/react';
import { Link } from 'wouter';
import { useLocale } from '../i18n/context.js';
import { STEAM_LINKS } from '../connectLinks.js';
import './settings.css';

type Status = { connected: boolean; steamId: string | null };

export function Connection(): React.JSX.Element {
  const { text } = useLocale();
  const [status, setStatus] = useState<Status | null>(null);
  const [dialog, setDialog] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function closeDialog(): void {
    setDialog(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const response = await fetch('/api/connect/status');
        if (!response.ok) {
          return;
        }
        const body = (await response.json()) as Status;
        if (!cancelled) {
          setStatus(body);
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

  useEffect(() => {
    if (dialog) {
      dialogRef.current?.focus();
    }
  }, [dialog ]);

  return (
    <section aria-labelledby="settings-conn-heading">
      <h2 id="settings-conn-heading">{text('settings.connTitle')}</h2>
      {status?.steamId !== null && status?.steamId !== undefined ? (
        <div className="settings-row">
          <span className="settings-label">{text('connect.steamIdLabel')}</span>
          <div className="settings-body">
            <span>
              <code>{status?.steamId}</code>
              <span>
                <LockSimple size={12} aria-hidden />
                {text('settings.idLocked')}
              </span>
            </span>
            <p>
              {text('settings.idHint')}{' '}
              <button
                type="button"
                ref={triggerRef}
                onClick={() => setDialog(true)}
              >
                {text('settings.idChange')}
              </button>
            </p>
          </div>
        </div>
      ) : null}
      {dialog ? (
        <div>
          <div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="settings-conn-dialog-title"
            tabIndex={-1}
            className="settings-dialog"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              closeDialog();
            }
            // 포커스 가능 요소가 확인 버튼 하나라 Tab/Shift+Tab을 그곳에 고정.
            if (event.key === 'Tab') {
              event.preventDefault();
              dialogRef.current
                ?.querySelector('button')
                ?.focus();
            }
          }}
        >
          <div>
            <span>
              <Prohibit size={18} aria-hidden />
            </span>
            <div>
              <h3 id="settings-conn-dialog-title">{text('settings.dialogTitle')}</h3>
              <p>{text('connect.fixedIdError')}</p>
            </div>
          </div>
          <div>
            <button type="button" onClick={() => closeDialog()}>
              {text('settings.dialogOk')}
            </button>
          </div>
          </div>
        </div>
      ) : null}
      <div className="settings-row">
        <span className="settings-label">{text('connect.keyLabel')}</span>
        <div className="settings-body">
          <div>
            {status?.connected === true ? (
              <span className="settings-saved">
                <CheckCircle size={16} aria-hidden />
                {text('settings.keySaved')}
              </span>
            ) : null}
            <Link href="/connect?edit=1">
              <Key size={14} aria-hidden />
              {text('connect.reEnter')}
            </Link>
          </div>
          <p>
            {text('settings.keyHint')}{' '}
            <a
              href={STEAM_LINKS.apiKey}
              target="_blank"
              rel="noopener noreferrer"
            >
              {text('settings.keyPage')}
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
