/** W5 연동 화면 — 입력 → 검증 → 원인 안내. 기능 단위만(시맨틱 HTML·role/aria·포커스). */
import { useEffect, useRef, useState } from 'react';
import { useLocale } from '../i18n/context.js';
import { STEAM_LINKS } from '../connectLinks.js';

type Connected = { steamId: string; permissionEnforced: boolean };

type StatusBody = {
  connected?: unknown;
  steamId?: unknown;
  permissionEnforced?: unknown;
};

type SubmitBody = { connected?: unknown; code?: unknown };

export function ConnectPage(): React.JSX.Element {
  const { text } = useLocale();
  type TextKey = Parameters<typeof text>[0];
  const [checking, setChecking] = useState(true);
  const [connected, setConnected] = useState<Connected | null>(null);
  const [editing, setEditing] = useState(false);
  const [keyText, setKeyText] = useState('');
  const [steamId, setSteamId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<TextKey | null>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const statusRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (errorKey !== null) {
      alertRef.current?.focus();
    }
  }, [errorKey]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const response = await fetch('/api/connect/status');
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
          setErrorKey('connect.submitFailed');
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

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setErrorKey(null);
    try {
      const response = await fetch('/api/connect', {
        method: 'POST',
        body: JSON.stringify({ keyText, steamId }),
      });
      const body = (await response.json()) as SubmitBody;
      if (response.ok && body.connected === true) {
        setConnected((prev) => ({
          steamId,
          permissionEnforced: prev?.permissionEnforced ?? true,
        }));
        setEditing(false);
        setKeyText('');
        statusRef.current?.focus();
      } else if (typeof body.code === 'string') {
        setErrorKey(`error.${body.code}` as TextKey);
      } else {
        setErrorKey('connect.submitFailed');
      }
    } catch {
      setErrorKey('connect.submitFailed');
    } finally {
      setSubmitting(false);
    }
  };

  const showForm = connected === null || editing;

  return (
    <main data-route="connect">
      <h1>{text('nav.connect')}</h1>
      {checking ? (
        <p aria-live="polite">{text('connect.checking')}</p>
      ) : (
        <div>
          {errorKey !== null && (
            <p ref={alertRef} role="alert" tabIndex={-1}>
              {text(errorKey)}
            </p>
          )}
          {!showForm && connected !== null ? (
            <section ref={statusRef} aria-live="polite" tabIndex={-1}>
              <p>{text('connect.success')}</p>
              <p>{text('connect.connectedAs', { steamId: connected.steamId })}</p>
              {!connected.permissionEnforced && (
                <p>{text('connect.noPermissionNote')}</p>
              )}
              <p>{text('connect.fixedIdNotice')}</p>
              <button
                onClick={() => {
                  setEditing(true);
                  setErrorKey(null);
                }}
              >
                {text('connect.reEnter')}
              </button>
            </section>
          ) : (
            <form
              onSubmit={(event) => {
                void submit(event);
              }}
            >
              <label>
                {text('connect.keyLabel')}
                <input
                  type="password"
                  value={keyText}
                  disabled={submitting}
                  onChange={(event) => {
                    setKeyText(event.currentTarget.value);
                  }}
                />
              </label>
              <label>
                {text('connect.steamIdLabel')}
                <input
                  value={steamId}
                  disabled={submitting || connected !== null}
                  onChange={(event) => {
                    setSteamId(event.currentTarget.value);
                  }}
                />
              </label>
              <button disabled={submitting}>
                {text(submitting ? 'connect.verifying' : 'connect.submit')}
              </button>
            </form>
          )}
          <section>
            <h2>{text('connect.issueTitle')}</h2>
            <p>{text('connect.issueKey')}</p>
            <p>
              {text('connect.issueLimited')}{' '}
              <a href={STEAM_LINKS.limitedFaq}>{text('connect.faqLinkText')}</a>
            </p>
            <p>
              <a href={STEAM_LINKS.apiKey}>{text('connect.steamLinkText')}</a>
            </p>
            <p>
              <a href={STEAM_LINKS.apiTerms}>{text('connect.termsLinkText')}</a>
            </p>
            <p>{text('connect.valveNotice')}</p>
            <p>{text('connect.revokeNotice')}</p>
          </section>
        </div>
      )}
    </main>
  );
}
