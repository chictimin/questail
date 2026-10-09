/**
 * W5-UI 연동 화면 — 7상태(design s1): 기본·검증 중·키 거절·프로필 못 찾음·네트워크·429·성공.
 * Alert 박스(폼 밖) vs 필드 오류(입력칸 아래) vs 사전 안내 분리. 문구는 ④까지 기존 키 유지.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CircleNotch, Key, User } from '@phosphor-icons/react';
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
  const { text } = useLocale();
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
    if (!succeeded) {
      return;
    }
    const timer = setTimeout(() => {
      // App 셸의 연동 상태를 먼저 갱신해야 /library 리다이렉트에 안 걸린다.
      void onConnected().finally(() => {
        navigate('/library');
      });
    }, 600);
    return () => {
      clearTimeout(timer);
    };
  }, [succeeded, navigate, onConnected]);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) {
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
        setSucceeded(true);
        statusRef.current?.focus();
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

  const showForm = connected === null || editing;

  const submitLabel = text(
    succeeded ? 'connect.success' : busy ? 'connect.verifying' : 'connect.submit',
  );

  const guide = (
    <section>
      <h2>{text('connect.issueTitle')}</h2>
      <section aria-labelledby="connect-needs-heading">
        <h3 id="connect-needs-heading">{text('connect.needsTitle')}</h3>
        <ul>
          <li>{text('connect.needsGames')}</li>
          <li>{text('connect.needsUnlimited')}</li>
          <li>{text('connect.needsLocal')}</li>
        </ul>
      </section>
      <section aria-labelledby="connect-warn-heading">
        <h3 id="connect-warn-heading">{text('connect.warnTitle')}</h3>
        <p>{text('connect.warnBody')}</p>
      </section>
      <ol>
        <li>
          <a href={STEAM_LINKS.apiKey}>{text('connect.issueStep1')}</a>
        </li>
        <li>
          {text('connect.issueStep2a')}{' '}
          <code>{text('connect.issueDomain')}</code>
          {text('connect.issueStep2b')}
        </li>
        <li>
          {text('connect.issueStep3')}{' '}
          <a href={STEAM_LINKS.apiTerms}>{text('connect.termsLinkText')}</a>
        </li>
      </ol>
      <details>
        <summary>{text('connect.accIssue')}</summary>
        <p>{text('connect.accNote')}</p>
        <p>
          {text('connect.issueLimited')}{' '}
          <a href={STEAM_LINKS.limitedFaq}>{text('connect.faqLinkText')}</a>
        </p>
      </details>
      <p>{text('connect.valveNotice')}</p>
      <p>{text('connect.revokeNotice')}</p>
    </section>
  );

  return (
    <main data-route="connect">
      <h1>{text('nav.connect')}</h1>
      <p>{text('connect.sub')}</p>
      {checking ? (
        <p aria-live="polite">{text('connect.checking')}</p>
      ) : (
        <div>
          {noticeKey !== null && (
            <div ref={noticeRef} role="alert" tabIndex={-1}>
              <p>{text(noticeKey)}</p>
            </div>
          )}
          {!showForm && connected !== null ? (
            <div>
              <section ref={statusRef} aria-live="polite" tabIndex={-1}>
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
              <div>
                <form
                onSubmit={(event) => {
                  void submit(event);
                }}
              >
                <label>
                  <Key size={16} aria-hidden />
                  {text('connect.keyLabel')}
                  <input
                    ref={keyRef}
                    type="password"
                    value={keyText}
                    placeholder={text('connect.keyPh')}
                    disabled={busy}
                    aria-invalid={keyError !== null}
                    aria-describedby="connect-key-error"
                    onChange={(event) => {
                      setKeyText(event.currentTarget.value);
                    }}
                  />
                </label>
                {keyError === null && <p>{text('connect.keyHint')}</p>}
                {keyError !== null && (
                  <p id="connect-key-error">{text(keyError)}</p>
                )}
                <label>
                  <User size={16} aria-hidden />
                  {text('connect.steamIdLabel')}
                  <input
                    ref={steamIdRef}
                    value={steamId}
                    placeholder={text('connect.idPh')}
                    disabled={busy || connected !== null}
                    aria-invalid={steamIdError !== null}
                    aria-describedby="connect-steamid-error"
                    onChange={(event) => {
                      setSteamId(event.currentTarget.value);
                    }}
                  />
                </label>
                {steamIdError === null && <p>{text('connect.idHint')}</p>}
                {steamIdError !== null && (
                  <p id="connect-steamid-error">{text(steamIdError)}</p>
                )}
                {showExamples && (
                  <div>
                    <p>{text('connect.exTitle')}</p>
                    <ul>
                      <li>
                        <span>{text('connect.exUrl')}</span>{' '}
                        <span>{text('connect.exUrlValue')}</span>
                      </li>
                      <li>
                        <span>{text('connect.exCustom')}</span>{' '}
                        <span>{text('connect.exCustomValue')}</span>
                      </li>
                      <li>
                        <span>{text('connect.exNum')}</span>{' '}
                        <span>{text('connect.exNumValue')}</span>
                      </li>
                    </ul>
                  </div>
                )}
                <button
                  disabled={busy}
                  aria-busy={busy}
                  className={
                    succeeded
                      ? 'connect-submit is-success'
                      : busy
                        ? 'connect-submit is-busy'
                        : 'connect-submit'
                  }
                >
                  {succeeded ? (
                    <Check size={16} aria-hidden />
                  ) : busy ? (
                    <CircleNotch size={16} aria-hidden />
                  ) : (
                    <ArrowRight size={16} aria-hidden />
                  )}
                  <span
                    key={submitLabel}
                    className={
                      busy ? 'connect-submit-label is-shimmer' : 'connect-submit-label'
                    }
                  >
                    {submitLabel}
                  </span>
                </button>
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
