/**
 * U5 공유 10a — 다이얼로그 560px · 미리보기 pre · "계정 정보는 들어가지 않아요" +
 * "리캡과 함께 내보내기"(recap이 있을 때만) · "텍스트 복사"(1.8초 뒤 복귀).
 * 미리보기·복사 텍스트는 data/tbtiShare.ts 렌더를 쓴다. 컴포넌트는 판정 출력 props로 받는다.
 */
import { useEffect, useRef, useState } from 'react';
import type { LibraryRecap, TbtiResult } from '@questail/core';
import { renderRecapExportFile } from '../../data/recapText.js';
import { renderTbtiShare } from '../../data/tbtiShare.js';
import { useLocale } from '../i18n/context.js';
import { MARKDOWN_MIME, downloadTextFile } from '../r15/download.js';
import type { GameNameMap } from '../r15/names.js';
import './share.css';

export function ShareSheet({
  result,
  recap,
  map,
  onClose,
}: {
  result: TbtiResult;
  recap: LibraryRecap | null;
  map: GameNameMap;
  onClose: () => void;
}): React.JSX.Element {
  const { locale, text } = useLocale();
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const preview = renderTbtiShare(result, locale);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

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
    try {
      await navigator.clipboard.writeText(preview);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // 클립보드 거부 — 조용히 둔다(다음 눌림에 다시 시도).
    }
  };

  const exportWithRecap = (): void => {
    if (recap === null) {
      return;
    }
    const names = new Map<string, string>();
    for (const [key, entry] of map) {
      if (entry.name !== null) {
        names.set(key, entry.name);
      }
    }
    const file = renderRecapExportFile(recap, locale, names);
    downloadTextFile(file.filename, file.content, MARKDOWN_MIME);
  };

  return (
    <div className="share-scrim" onClick={onClose} aria-hidden="true">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={text('share.title')}
        tabIndex={-1}
        className="share-sheet"
        onClick={(event) => event.stopPropagation()}
        aria-hidden="false"
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
        <pre className="share-preview">{preview}</pre>
        <div className="share-foot">
          <p className="share-note">{text('share.note')}</p>
          <div className="share-actions">
            {recap !== null ? (
              <button
                type="button"
                className="share-secondary"
                onClick={exportWithRecap}
              >
                {text('share.withRecap')}
              </button>
            ) : null}
            <button type="button" className="share-primary" onClick={copy}>
              {copied ? text('share.copied') : text('share.copy')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
