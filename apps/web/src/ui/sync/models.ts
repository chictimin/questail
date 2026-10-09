/**
 * U3b [2] sync 화면 매핑 — 순수 함수. DTO → 행 모델·상단 시각·검토 목록.
 * f(부분 실패): pill hold + causeInfoPart {n} + 재수집 (U3b 결정, 보고 명시).
 * 업적 OFF는 호출 측에서 덮어쓴다(행 모델 아님).
 */
import type { SyncErrorCode } from '@questail/core';
import type { SyncStatusEntry } from '../../data/sync.js';
import type { CollectSource as DataSource } from '../../data/syncRuns.js';
import {
  rowDisplay,
  type CollectSource as UiSource,
  type RowBody,
  type SyncPill,
} from './statusMap.js';

export interface SyncRowView {
  source: UiSource;
  time: number | null;
  pill: SyncPill;
  body: RowBody;
  progress?: { pct: number; label: string };
  retry: boolean;
}

/** 데이터 소스 → UI 소스 (U3a 짧은 이름). */
const DATA_TO_UI_SOURCE: Record<DataSource, UiSource> = {
  owned: 'owned',
  wishlist: 'wish',
  meta: 'info',
  achievements: 'ach',
  steamspy: 'tags',
};

/** 행 표시값. 시각은 epoch 초 그대로(표기는 호출 측 formatDateTime). */
export function rowViewFor(
  entry: SyncStatusEntry,
  achievementsEnabled = true,
): SyncRowView {
  const source = DATA_TO_UI_SOURCE[entry.source];
  if (entry.source === 'achievements' && !achievementsEnabled) {
    return {
      source,
      time: null,
      pill: 'off',
      body: { kind: 'none' },
      retry: false,
    };
  }
  if (entry.failedItems !== undefined && entry.failedItems > 0) {
    return {
      source,
      time: entry.lastFinishedAt,
      pill: 'hold',
      body: {
        kind: 'cause',
        key: 'sync.causeInfoPart',
        params: { n: entry.failedItems },
      },
      retry: true,
    };
  }
  // issue.code는 계약상 SyncErrorCode다(parseIssue). string이라 캐스트한다.
  const code = (entry.issue?.code ?? null) as SyncErrorCode | null;
  const display = rowDisplay(source, {
    code,
    failed: entry.state === 'failed',
    running: entry.state === 'running',
    params: entry.issue?.params,
  });
  const body: RowBody = { ...display.body };
  if (
    body.kind === 'cause' &&
    entry.source === 'achievements' &&
    code === 'ACCESS_PRIVATE'
  ) {
    // 근거: Steam 프로필 → 프로필 편집 → 개인정보 설정 경로 (paru 조사 2026-10-09).
    // 공식 문서 직접 기재 아님 — 대조 때 재확인.
    body.link = {
      href: 'https://steamcommunity.com/my/edit/settings',
      label: 'sync.achOpenLink',
    };
  }
  return {
    source,
    time: entry.lastFinishedAt,
    pill: display.pill,
    body,
    progress:
      entry.progress.total === null
        ? { pct: 0, label: `${entry.progress.done}` }
        : {
            pct:
              entry.progress.total === 0
                ? 0
                : Math.min(
                    100,
                    Math.round((entry.progress.done / entry.progress.total) * 100),
                  ),
            label: `${entry.progress.done}/${entry.progress.total}`,
          },
    retry: display.retry,
  };
}

/**
 * 상단 "마지막 수집" — ok 소스 lastFinishedAt 최댓값(epoch 초).
 * 업적 OFF면 업적 run 제외. 없으면 null.
 */
export function latestFinishedAt(
  entries: SyncStatusEntry[],
  achievementsEnabled: boolean,
): number | null {
  let latest: number | null = null;
  for (const entry of entries) {
    if (entry.source === 'achievements' && !achievementsEnabled) continue;
    if (entry.state !== 'ok' || entry.lastFinishedAt === null) continue;
    if (latest === null || entry.lastFinishedAt > latest) {
      latest = entry.lastFinishedAt;
    }
  }
  return latest;
}
