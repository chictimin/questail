/**
 * W-export 내보내기 화면 — 대기 → 내보내는 중 → 완료/실패. API 단발 POST라 진행률 없음.
 * 보유 수는 GET /api/library 길이 재사용. 키 미포함 고지.
 */
import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle,
  CircleNotch,
  Copy,
  Export,
  FileText,
  Key,
  XCircle,
} from '@phosphor-icons/react';
import { useLocale } from '../i18n/context.js';
import '../export/export.css';

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
  const dirRef = useRef<HTMLElement>(null);

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

  const run = async (): Promise<void> => {
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
      // input 시절의 select() 대신 <code> 텍스트를 Range로 선택.
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

  return (
    <main data-route="export">
      <h1>{text('nav.export')}</h1>
      <p>{text('export.sub')}</p>
      <div className="export-cols">
        <div className="export-card">
          {done !== null && (
            <div>
              <div className="export-folder-label">{text('export.folder')}</div>
              <div className="export-folder-row">
                <code ref={dirRef} className="export-dir">{done.dir}</code>
                <button
                  type="button"
                  onClick={() => {
                    void copy();
                  }}
                  className="export-copy"
                >
                  <Copy size={15} aria-hidden />
                  {text('export.copyDir')}
                </button>
              </div>
            </div>
          )}
          {count !== null && (
            <div className="export-bignum-row">
              <span className="export-bignum">{count}</span>
              <span className="export-eq">{text('export.eq', { n: count })}</span>
            </div>
          )}
          {errorKey !== null && (
            <div ref={alertRef} role="alert" tabIndex={-1} className="export-alert">
              <XCircle size={18} className="export-alert-icon" aria-hidden />
              <div className="export-alert-body">
                <b className="export-alert-word">{text('export.wordFail')}</b>
                {text(errorKey)}
              </div>
              <button
                type="button"
                onClick={() => {
                  void run();
                }}
                className="export-again"
              >
                {text('export.again')}
              </button>
            </div>
          )}
          {done !== null && (
            <section
              ref={doneRef}
              aria-live="polite"
              tabIndex={-1}
              className="export-done"
            >
              <CheckCircle size={18} className="export-done-icon" aria-hidden />
              <div className="export-done-body">
                <b className="export-done-word">{text('export.wordDone')}</b>
                {text('export.done', { n: done.written })}
              </div>
              <button
                type="button"
                onClick={() => {
                  void run();
                }}
                className="export-again"
              >
                {text('export.again')}
              </button>
            </section>
          )}
          {copied && <p aria-live="polite">{text('export.copied')}</p>}
          {copyFailed && <p aria-live="polite">{text('export.copyFallback')}</p>}
          <div className="export-actions">
            {done === null && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run();
                }}
              >
                <button
                  disabled={busy}
                  aria-busy={busy}
                  className="export-go"
                >
                  {busy ? (
                    <>
                      <CircleNotch
                        size={16}
                        className="export-go-spin"
                        aria-hidden
                      />
                      <span className="export-go-shimmer">
                        {text('export.exporting')}
                      </span>
                    </>
                  ) : (
                    <>
                      <Export size={16} aria-hidden />
                      {text('export.go')}
                    </>
                  )}
                </button>
              </form>
            )}
            <span className="export-nokey">
              <Key size={14} aria-hidden />
              {text('export.noKey')}
            </span>
          </div>
        </div>
        <div className="export-card">
          <div className="export-sample-head">
            <FileText
              size={16}
              className="export-sample-head-icon"
              aria-hidden
            />
            <h2>{text('export.sample')}</h2>
          </div>
          <pre className="export-sample-pre">{text('export.sampleBody')}</pre>
        </div>
      </div>
    </main>
  );
}
