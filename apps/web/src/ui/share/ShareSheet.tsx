/**
 * U5 공유 10a — 다이얼로그 560px · 미리보기 pre · "계정 정보는 들어가지 않아요" +
 * "리캡과 함께 내보내기"(recap이 있을 때만) · "텍스트 복사"(1.8초 뒤 복귀).
 * 미리보기·복사·내보내기 텍스트는 서버 렌더(R15-9 — /api/tbti/share-text·/api/recap/library/text, 화면 locale 쿼리).
 */
import { useEffect, useRef, useState } from 'react';
import { useLocale } from '../i18n/context.js';
import { MARKDOWN_MIME, downloadTextFile } from '../r15/download.js';
import { fetchRecapMarkdown, fetchTbtiShareText } from '../r15/text.js';
import './share.css';

type Preview = { state: 'loading' } | { state: 'ready'; text: string } | { state: 'failed' };

/**
 * 구조(F-23): 바깥 층(.share-scrim) 안에 배경(.share-backdrop, aria-hidden)과 dialog를 형제로 둔다.
 * aria-hidden을 dialog 조상에 두면 시트 전체가 보조기기에서 사라진다.
 */
export function ShareSheet({
  hasRecap,
  onClose,
}: {
  /** 리캡이 있을 때만 리캡 동반 내보내기 버튼을 보인다. */
  hasRecap: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const { locale, text } = useLocale();
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<Preview>({ state: 'loading' });
  const [exportFailed, setExportFailed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // 미리보기 = 복사 텍스트 = 서버 렌더(R15-9, F-12).
  useEffect(() => {
    let cancelled = false;
    setPreview({ state: 'loading' });
    fetchTbtiShareText(locale)
      .then((value) => {
        if (!cancelled) {
          setPreview({ state: 'ready', text: value });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreview({ state: 'failed' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async (): Promise<void> => {
    if (preview.state !== 'ready') {
      return;
    }
    try {
      await navigator.clipboard.writeText(preview.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // 클립보드 거부 — 조용히 둔다(다음 눌림에 다시 시도).
    }
  };

  const exportWithRecap = async (): Promise<void> => {
    setExportFailed(false);
    try {
      const file = await fetchRecapMarkdown(locale);
      downloadTextFile(file.filename, file.text, MARKDOWN_MIME);
    } catch {
      setExportFailed(true);
    }
  };

  return (
    <div className="share-scrim">
      <div className="share-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={text('share.title')}
        tabIndex={-1}
        className="share-sheet"
      >
        <div className="share-head">
          <p className="share-title">{text('share.title')}</p>
          <button
            type="button"
            className="share-close"
            aria-label={text('share.closeLabel')}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {preview.state === 'failed' ? (
          <p className="share-error" role="alert">
            {text('share.loadFailed')}
          </p>
        ) : (
          <pre className="share-preview" aria-busy={preview.state === 'loading'}>
            {preview.state === 'ready' ? preview.text : ''}
          </pre>
        )}
        {exportFailed ? (
          <p className="share-error" role="alert">
            {text('recap.textFailed')}
          </p>
        ) : null}
        <div className="share-foot">
          <p className="share-note">{text('share.note')}</p>
          <div className="share-actions">
            {hasRecap ? (
              <button
                type="button"
                className="share-secondary"
                onClick={() => void exportWithRecap()}
              >
                {text('share.withRecap')}
              </button>
            ) : null}
            <button
              type="button"
              className="share-primary"
              disabled={preview.state !== 'ready'}
              onClick={() => void copy()}
            >
              {copied ? text('share.copied') : text('share.copy')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
