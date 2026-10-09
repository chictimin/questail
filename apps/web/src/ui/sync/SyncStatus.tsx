/**
 * U3a 수집 상태 조립 — Alert + 소스 5행 + 검토 대기 + 언어 안내 + 시각 고지.
 * export만 하고 routes/sync.tsx에서는 조립하지 않는다(U3b 배선 때 연결).
 */
import { Books, Heart, Info, Tag, Trophy } from '@phosphor-icons/react';
import { useLocale } from '../i18n/context.js';
import { KeyAlert, SourceRow } from './SourceRow.js';
import type { RowBody, SyncPill } from './statusMap.js';
import { ReviewQueue, type ReviewItem } from './ReviewQueue.js';
import './sync.css';

const SOURCE_ICONS = {
  owned: Books,
  info: Info,
  wish: Heart,
  tags: Tag,
  ach: Trophy,
} as const;

const SOURCE_NAMES = {
  owned: 'sync.sourceOwned',
  info: 'sync.sourceInfo',
  wish: 'sync.sourceWish',
  tags: 'sync.sourceTags',
  ach: 'sync.sourceAch',
} as const;

export interface SyncRowModel {
  source: keyof typeof SOURCE_ICONS;
  time: string | null;
  pill: SyncPill;
  body: RowBody;
  progress?: { pct: number; label: string };
  retry: boolean;
  onRetry?: () => void;
}

export function SyncStatus({
  alert,
  rows,
  review,
  reviewDefaultOpen = false,
  updatedAt,
}: {
  /** h 키 거절 시에만 alert. */
  alert: boolean;
  rows: SyncRowModel[];
  review: ReviewItem[];
  reviewDefaultOpen?: boolean;
  /** 마지막 전체 수집 시각(ISO 표기) 또는 null. */
  updatedAt: string | null;
}): React.JSX.Element {
  const { text } = useLocale();
  return (
    <div>
      <p className="sync-note">{text('sync.localeNote')}</p>
      {alert ? <KeyAlert /> : null}
      <div className="sync-rows">
        {rows.map((model) => (
          <SourceRow
            key={model.source}
            icon={SOURCE_ICONS[model.source]}
            nameKey={SOURCE_NAMES[model.source]}
            time={model.time}
            pill={model.pill}
            body={model.body}
            progress={model.progress}
            retry={model.retry}
            onRetry={model.onRetry}
          />
        ))}
        <ReviewQueue items={review} defaultOpen={reviewDefaultOpen} />
      </div>
      {updatedAt === null ? null : (
        <p className="sync-note">{text('sync.sub', { t: updatedAt })}</p>
      )}
      <p className="sync-foot">{text('sync.stFoot')}</p>
    </div>
  );
}
