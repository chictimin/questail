/** U3a 검토 대기 접힘 목록 — 표시만. 그대로 두기/반영 버튼 없음(PM #75288). */
import { useState } from 'react';
import { CaretDown, CaretUp, ListChecks } from '@phosphor-icons/react';
import { useLocale } from '../i18n/context.js';
import './sync.css';

export interface ReviewItem {
  title: string;
  desc: string;
}

export function ReviewQueue({
  items,
  defaultOpen = false,
}: {
  items: ReviewItem[];
  defaultOpen?: boolean;
}): React.JSX.Element {
  const { locale, text } = useLocale();
  const [open, setOpen] = useState(defaultOpen);
  const count = new Intl.NumberFormat(locale).format(items.length);
  const Caret = open ? CaretUp : CaretDown;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="sync-review-toggle"
      >
        <ListChecks size={16} className="sync-review-toggle-icon" aria-hidden />
        <span className="sync-review-label">
          {text('sync.review')} {count}
          {text('sync.reviewUnit')}
        </span>
        <Caret size={16} aria-hidden />
      </button>
      {open ? (
        <div className="sync-review-list">
          {items.map((item) => (
            <div key={`${item.title} ${item.desc}`} className="sync-review-item">
              <div className="sync-review-text">
                <span className="sync-review-title">{item.title}</span>
                <span className="sync-review-desc">{item.desc}</span>
              </div>
            </div>
          ))}
          {items.length === 0 ? (
            <div className="sync-review-empty">{text('sync.reviewEmpty')}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
