/**
 * W5-UI 연동 화면 — 7상태(design s1): 기본·검증 중·키 거절·프로필 못 찾음·네트워크·429·성공.
 * Alert 박스(폼 밖) vs 필드 오류(입력칸 아래) vs 사전 안내 분리. 문구는 ④까지 기존 키 유지.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  CaretDown,
  CaretUp,
  Check,
  CircleNotch,
  HandPalm,
  HardDrives,
  Key,
  LockSimple,
  Question,
  User,
  Warning,
  XCircle,
} from '@phosphor-icons/react';
import { Link, useLocation } from 'wouter';
import { useLocale } from '../i18n/context.js';
import { STEAM_LINKS } from '../connectLinks.js';
import { parseSteamIdInput } from '../steamId.js';
import '../connect.css';

type Connected = { steamId: string; permissionEnforced: boolean };

type StatusBody = {
  connected?: unknown;
  steamId?: unknown;
  permissionEnforced?: unknown;
};

/**
 * 실패 코드+reason → 표시 문구 키. 순수 함수(단위 테스트용).
 * fixed_id는 d_body, 그 외 AUTH_ID_MISMATCH는 e_id다(계약 v1.5.4 384-386/445·495).
 */
export function resolveConnectError(
  code: string,
  reason: unknown,
): { field: 'key' | 'steamId' | 'notice'; key: string } {
  if (code === 'AUTH_INVALID_KEY') {
    return { field: 'key', key: 'error.AUTH_INVALID_KEY' };
  }
  if (code === 'AUTH_ID_MISMATCH') {
    if (reason === 'fixed_id') {
      return { field: 'steamId', key: 'connect.fixedIdError' };
    }
    return { field: 'steamId', key: 'error.AUTH_ID_MISMATCH' };
  }
  if (code === 'KEY_STORE_FAILED') {
    return { field: 'steamId', key: 'error.KEY_STORE_FAILED' };
  }
  return { field: 'notice', key: `error.${code}` };
}

type SubmitBody = {
  connected?: unknown;
  code?: unknown;
  params?: { reason?: unknown };
};

export function ConnectPage({
  onConnected,
}: {
  onConnected(): Promise<void>;
}): React.JSX.Element {
  const { locale, text } = useLocale();
  type TextKey = Parameters<typeof text>[0];
  const [, navigate] = useLocation();
  const [checking, setChecking] = useState(true);
  const [connected, setConnected] = useState<Connected | null>(null);
  const [editing, setEditing] = useState(false);
  const [keyText, setKeyText] = useState('');
  const [steamId, setSteamId] = useState('');
  const [busy, setBusy] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [keyError, setKeyError] = useState<TextKey | null>(null);
  const [steamIdError, setSteamIdError] = useState<TextKey | null>(null);
  const [showExamples, setShowExamples] = useState(false);
  const [noticeKey, setNoticeKey] = useState<TextKey | null>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const steamIdRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (keyError !== null) {
      keyRef.current?.focus();
    } else if (steamIdError !== null) {
      steamIdRef.current?.focus();
    } else if (noticeKey !== null) {
      noticeRef.current?.focus();
    }
  }, [keyError, steamIdError, noticeKey]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const response = await fetch('/api/connect/status');
        if (!response.ok) {
          if (!cancelled) {
            setConnected(null);
          }
          return;
        }
        const body = (await response.json()) as StatusBody;
        if (cancelled) {
          return;
        }
        if (body.connected === true && typeof body.steamId === 'string') {
          setConnected({
            steamId: body.steamId,
            permissionEnforced: body.permissionEnforced === true,
          });
          setSteamId(body.steamId);
        } else {
          setConnected(null);
        }
      } catch {
        if (!cancelled) {
          setNoticeKey('connect.submitFailed');
        }
      } finally {
        if (!cancelled) {
          setChecking(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (succeeded) {
      submitRef.current?.focus();
    }
  }, [succeeded]);

  useEffect(() => {
    if (!succeeded) {
      return;
    }
    // AUTO-SYNC: 연동 직후 첫 수집 1회 (plan-r1.md:50). 202·409·실패 모두
    // 아래 600ms 이동대로 간다 — await하지 않아 이동이 늦어지지 않는다.
    fetch('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale }),
    }).catch(() => undefined);
    const timer = setTimeout(() => {
      // App 셸의 연동 상태를 먼저 갱신해야 /library 리다이렉트에 안 걸린다.
      void onConnected().finally(() => {
        navigate('/library');
      });
    }, 600);
    return () => {
      clearTimeout(timer);
    };
  }, [succeeded, navigate, onConnected, locale]);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || succeeded) {
      return;
    }
    const parsed = parseSteamIdInput(steamId);
    if (parsed.blocked && parsed.vanity === null) {
      setKeyError(null);
      setSteamIdError('error.INVALID_BODY');
      setShowExamples(true);
      setNoticeKey(null);
      return;
    }
    const idToSend = parsed.blocked ? steamId : parsed.steamId;
    const vanityToSend = parsed.blocked ? parsed.vanity : undefined;
    setBusy(true);
    setKeyError(null);
    setSteamIdError(null);
    setShowExamples(false);
    setNoticeKey(null);
    try {
      const response = await fetch('/api/connect', {
        method: 'POST',
        body: JSON.stringify(
          vanityToSend === undefined
            ? { keyText, steamId: idToSend }
            : { keyText, steamId: idToSend, vanity: vanityToSend },
        ),
      });
      const body = (await response.json()) as SubmitBody;
      if (response.ok && body.connected === true) {
        setConnected((prev) => ({
          steamId: idToSend,
          permissionEnforced: prev?.permissionEnforced ?? true,
        }));
        setEditing(false);
        setKeyText('');
        setBusy(false);
        setSucceeded(true);
        return;
      }
      setBusy(false);
      if (typeof body.code !== 'string') {
        setNoticeKey('connect.submitFailed');
        return;
      }
      const reason =
        typeof body.params?.reason === 'string' ? body.params.reason : null;
      const resolved = resolveConnectError(body.code, reason);
      if (resolved.field === 'key') {
        setKeyError(resolved.key as TextKey);
      } else if (resolved.field === 'steamId') {
        setSteamIdError(resolved.key as TextKey);
        if (resolved.key === 'error.AUTH_ID_MISMATCH') {
          setShowExamples(true);
        }
      } else {
        setNoticeKey(resolved.key as TextKey);
      }
    } catch {
      setBusy(false);
      setNoticeKey('connect.submitFailed');
    }
  };

  const showForm = connected === null || editing || succeeded;

  const submitLabel = text(
    succeeded ? 'connect.success' : busy ? 'connect.verifying' : 'connect.submit',
  );

  const guide = (
    <aside className="connect-guide">
      <h2>{text('connect.issueTitle')}</h2>
      <ol className="connect-steps">
        <li>
          <span>
            <a href={STEAM_LINKS.apiKey}>{text('connect.issueStep1')}</a>
          </span>
        </li>
        <li>
          <span>
            {text('connect.issueStep2a')}{' '}
            <code>{text('connect.issueDomain')}</code>
            {text('connect.issueStep2b')}
          </span>
        </li>
        <li>
          <span>{text('connect.issueStep3')}</span>
        </li>
      </ol>
      <div className="connect-needs">
        <p className="connect-needs-title">{text('connect.needsTitle')}</p>
        <p className="connect-need">
          <Check size={16} aria-hidden />
          <span>{text('connect.needsGames')}</span>
        </p>
        <p className="connect-need">
          <Check size={16} aria-hidden />
          <span>{text('connect.needsUnlimited')}</span>
        </p>
        <p className="connect-need">
          <HardDrives size={16} aria-hidden />
          <span>{text('connect.needsLocal')}</span>
        </p>
      </div>
      <div tabIndex={0} className="qt-notice--warn connect-warn">
        <HandPalm size={18} aria-hidden />
        <div>
          <strong>{text('connect.warnTitle')}</strong> {text('connect.warnBody')}
        </div>
      </div>
      <div className="connect-acc">
        <details>
          <summary className="qt-btn connect-acc-head">
            <Question size={16} aria-hidden />
            <span>{text('connect.accIssue')}</span>
            <CaretDown size={16} aria-hidden className="connect-acc-down" />
            <CaretUp size={16} aria-hidden className="connect-acc-up" />
          </summary>
          <div className="connect-acc-body">
            <p>{text('connect.accNote')}</p>
            <p>{text('connect.issueLimited')}</p>
          </div>
        </details>
      </div>
    </aside>
  );

  return (
    <main data-route="connect">
      <div className="connect-head">
        <h1>{text('nav.connect')}</h1>
        <p>{text('connect.sub')}</p>
      </div>
      {checking ? (
        <p aria-live="polite">{text('connect.checking')}</p>
      ) : (
        <div className="connect-body">
          {noticeKey !== null && (
            <div
              ref={noticeRef}
              role="alert"
              tabIndex={-1}
              className="qt-alert connect-alert"
            >
              <Warning size={18} aria-hidden />
              <div className="connect-alert-text">{text(noticeKey)}</div>
            </div>
          )}
          {!showForm && connected !== null ? (
            <div>
              <section
                ref={statusRef}
                aria-live="polite"
                tabIndex={-1}
                className="qt-card connect-done"
              >
                <p>{text('connect.success')}</p>
                <p>{text('connect.connectedAs', { steamId: connected.steamId })}</p>
                {!connected.permissionEnforced && (
                  <p>{text('connect.noPermissionNote')}</p>
                )}
                <p>{text('connect.fixedIdNotice')}</p>
                <p>
                  {text('connect.localeNotice')}{' '}
                  <Link href="/settings">{text('nav.settings')}</Link>
                </p>
                <button
                  className="qt-btn qt-btn--secondary"
                  onClick={() => {
                    setEditing(true);
                    setKeyError(null);
                    setSteamIdError(null);
                    setNoticeKey(null);
                  }}
                >
                  {text('connect.reEnter')}
                </button>
                <p>{text('connect.goList')}</p>
              </section>
              {guide}
            </div>
          ) : (
            <div className="connect-layout">
              <div className="connect-formwrap">
                <form
                  className="connect-form"
                  aria-busy={busy}
                  onSubmit={(event) => {
                    void submit(event);
                  }}
                >
                  <div
                    className={busy ? 'connect-field is-locked' : 'connect-field'}
                  >
                    <label htmlFor="connect-key">
                      {text('connect.keyLabel')}
                      {busy && <LockSimple size={14} aria-hidden />}
                    </label>
                    <div className="qt-field">
                      <Key size={16} aria-hidden />
                      <input
                        id="connect-key"
                        ref={keyRef}
                        type="password"
                        className="qt-input"
                        value={keyText}
                        placeholder={text('connect.keyPh')}
                        disabled={busy}
                        aria-invalid={keyError !== null}
                        aria-describedby={
                          keyError !== null ? 'connect-key-error' : 'connect-key-hint'
                        }
                        onChange={(event) => {
                          setKeyText(event.currentTarget.value);
                        }}
                      />
                    </div>
                    {keyError === null && (
                      <p id="connect-key-hint" className="connect-hint">
                        {text('connect.keyHint')}
                      </p>
                    )}
                    {keyError !== null && (
                      <p id="connect-key-error" role="alert" className="connect-error">
                        <XCircle size={16} aria-hidden />
                        <span>
                          <strong>{text('connect.errPrefix')}</strong>{' '}
                          {text(keyError)}
                        </span>
                      </p>
                    )}
                  </div>
                  <div
                    className={busy ? 'connect-field is-locked' : 'connect-field'}
                  >
                    <label htmlFor="connect-steamid">
                      {text('connect.steamIdLabel')}
                      {busy && <LockSimple size={14} aria-hidden />}
                    </label>
                    <div className="qt-field">
                      <User size={16} aria-hidden />
                      <input
                        id="connect-steamid"
                        ref={steamIdRef}
                        className="qt-input"
                        value={steamId}
                        placeholder={text('connect.idPh')}
                        disabled={busy || connected !== null}
                        aria-invalid={steamIdError !== null}
                        aria-describedby={
                          steamIdError !== null
                            ? 'connect-steamid-error'
                            : 'connect-steamid-hint'
                        }
                        onChange={(event) => {
                          setSteamId(event.currentTarget.value);
                        }}
                      />
                    </div>
                    {steamIdError === null && (
                      <p id="connect-steamid-hint" className="connect-hint">
                        {text('connect.idHint')}
                      </p>
                    )}
                    {steamIdError !== null && (
                      <p
                        id="connect-steamid-error"
                        role="alert"
                        className="connect-error"
                      >
                        <XCircle size={16} aria-hidden />
                        <span>
                          <strong>{text('connect.errPrefix')}</strong>{' '}
                          {text(steamIdError)}
                        </span>
                      </p>
                    )}
                  </div>
                  {showExamples && (
                    <div className="connect-examples">
                      <p className="connect-examples-title">
                        {text('connect.exTitle')}
                      </p>
                      <ul>
                        <li>
                          <span>{text('connect.exUrl')}</span>
                          <code>{text('connect.exUrlValue')}</code>
                        </li>
                        <li>
                          <span>{text('connect.exCustom')}</span>
                          <code>{text('connect.exCustomValue')}</code>
                        </li>
                        <li>
                          <span>{text('connect.exNum')}</span>
                          <code>{text('connect.exNumValue')}</code>
                        </li>
                      </ul>
                    </div>
                  )}
                  <div className="connect-actions">
                    <button
                      ref={submitRef}
                      disabled={busy}
                      aria-busy={busy}
                      aria-disabled={succeeded || undefined}
                      className={
                        succeeded
                          ? 'qt-btn qt-btn--primary connect-submit is-success'
                          : busy
                            ? 'qt-btn qt-btn--primary connect-submit is-busy'
                            : 'qt-btn qt-btn--primary connect-submit'
                      }
                    >
                      {succeeded ? (
                        <Check size={16} aria-hidden />
                      ) : busy ? (
                        <CircleNotch size={16} aria-hidden className="qt-spin" />
                      ) : (
                        <ArrowRight size={16} aria-hidden />
                      )}
                      <span
                        key={submitLabel}
                        className={
                          busy && !succeeded
                            ? 'connect-submit-label is-shimmer'
                            : 'connect-submit-label'
                        }
                      >
                        {submitLabel}
                      </span>
                    </button>
                    {succeeded && (
                      <span className="connect-golist">{text('connect.goList')}</span>
                    )}
                    {succeeded && (
                      <p className="connect-hint">
                        {text('connect.localeNotice')}{' '}
                        <Link href="/settings">{text('nav.settings')}</Link>
                      </p>
                    )}
                  </div>
                </form>
              </div>
              {guide}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
