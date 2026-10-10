/** W8 업적 토글 — GET 표시 · PUT 확정(낙관적 반영 없음) · 실패 시 원값 + 재시도. */
import { useEffect, useState } from 'react';
import { useLocale } from '../i18n/context.js';
import { Pill } from '../sync/Pill.js';
import './settings.css';

type LoadStatus = 'loading' | 'ready' | 'failed';

export function Achievements(): React.JSX.Element {
  const { text } = useLocale();
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function load(): Promise<void> {
    setStatus('loading');
    setFailed(false);
    try {
      const response = await fetch('/api/settings/achievements');
      if (!response.ok) {
        throw new Error(`[web] 업적 설정 조회 실패: ${response.status}`);
      }
      const body = (await response.json()) as { enabled: boolean };
      setEnabled(body.enabled);
      setStatus('ready');
    } catch {
      setStatus('failed');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle(): Promise<void> {
    const next = !enabled;
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch('/api/settings/achievements', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!response.ok) {
        throw new Error(`[web] 업적 설정 저장 실패: ${response.status}`);
      }
      const body = (await response.json()) as { enabled: boolean };
      setEnabled(body.enabled);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  if (status === 'loading') {
    return <div aria-busy={true} />;
  }

  if (status === 'failed') {
    return (
      <div role="alert">
        <p>{text('library.loadFailed')}</p>
        <button type="button" onClick={() => void load()}>
          {text('library.reload')}
        </button>
      </div>
    );
  }

  return (
    <section aria-labelledby="achievements-heading">
      <h2 id="achievements-heading">{text('settings.achTitle')}</h2>
      <div className="settings-row">
        <div className="settings-label">
          <span>{text('settings.achRow')}</span>
          <span>{text('settings.achDesc')}</span>
        </div>
        <div className="settings-body">
          <span>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={text('settings.achRow')}
              disabled={pending}
              onClick={() => void toggle()}
            />{' '}
            <Pill pill={enabled ? 'done' : 'off'} />
          </span>
          <p>{text('settings.achPublic')}</p>
          <p>{text('settings.tbtiNote')}</p>
        </div>
      </div>
      {failed ? <p role="status">{text('settings.saveFailed')}</p> : null}
    </section>
  );
}
