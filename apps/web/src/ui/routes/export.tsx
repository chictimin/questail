/**
 * W-export 내보내기 화면 — 대기 → 내보내는 중 → 완료/실패. API 단발 POST라 진행률 없음.
 * 보유 수는 GET /api/library 길이 재사용. 키 미포함 고지.
 */
import { useEffect, useRef, useState } from 'react';
import { useLocale } from '../i18n/context.js';

type ExportResult = { written?: unknown; dir?: unknown; code?: unknown };

export function ExportPage(): React.JSX.Element {
  const { locale, text } = useLocale();
  type TextKey = Parameters<typeof text>[0];
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ written: number; dir: string } | null>(null);
  const [errorKey, setErrorKey] = useState<TextKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const response = await fetch('/api/library?includeEnded=false');
        if (!response.ok) {
          return;
        }
        const body = (await response.json()) as unknown[];
        if (!cancelled && Array.isArray(body)) {
          setCount(body.length);
        }
      } catch {
        if (!cancelled) {
          setCount(null);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (errorKey !== null) {
      alertRef.current?.focus();
    }
  }, [errorKey]);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    setErrorKey(null);
    setDone(null);
    setCopied(false);
    setCopyFailed(false);
    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        body: JSON.stringify({ locale }),
      });
      const body = (await response.json()) as ExportResult;
      if (
        response.ok &&
        typeof body.written === 'number' &&
        typeof body.dir === 'string'
      ) {
        setDone({ written: body.written, dir: body.dir });
        doneRef.current?.focus();
      } else if (typeof body.code === 'string') {
        setErrorKey(`error.${body.code}` as TextKey);
      } else {
        setErrorKey('error.EXPORT_FAILED');
      }
    } catch {
      setErrorKey('error.EXPORT_FAILED');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (): Promise<void> => {
    if (done === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(done.dir);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      dirRef.current?.select();
      setCopied(false);
      setCopyFailed(true);
    }
  };

  return (
    <main data-route="export">
      <h1>{text('nav.export')}</h1>
      <p>{text('export.sub')}</p>
      {errorKey !== null && (
        <div ref={alertRef} role="alert" tabIndex={-1}>
          <p>{text(errorKey)}</p>
        </div>
      )}
      {count !== null && <p>{text('export.eq', { n: count })}</p>}
      <section>
        <h2>{text('export.sample')}</h2>
        <pre>{text('export.sampleBody')}</pre>
      </section>
      {done !== null ? (
        <section ref={doneRef} aria-live="polite" tabIndex={-1}>
          <p>{text('export.done', { n: done.written })}</p>
          <p>{text('export.folder')}</p>
          <input ref={dirRef} value={done.dir} readOnly />
          <button
            onClick={() => {
              void copy();
            }}
          >
            {text('export.copyDir')}
          </button>
          {copied && <p aria-live="polite">{text('export.copied')}</p>}
          {copyFailed && <p aria-live="polite">{text('export.copyFallback')}</p>}
        </section>
      ) : (
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <button disabled={busy} aria-busy={busy}>
            {text(busy ? 'export.exporting' : 'export.go')}
          </button>
        </form>
      )}
      <p>{text('export.noKey')}</p>
    </main>
  );
}
