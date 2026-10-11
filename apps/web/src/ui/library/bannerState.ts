/**
 * 첫 수집 직후 진행 배너(②-b) 판정 — 순수 함수.
 * 배너: meta 수집이 돌고 있고 커버·장르 미보충 행이 1개 이상일 때만(PM 결정 A).
 * 보충 중 판정은 GameRow의 rowBadges를 그대로 쓴다(복제 금지).
 */
import type { SyncStatusEntry } from '../../data/sync.js';
import { rowBadges, type RowGame } from './GameRow.js';

export interface FirstSyncBannerModel {
  /** 라이브러리 행 수. */
  n: number;
  done: number;
  /** 큐 확정 전에는 null. */
  total: number | null;
}

function runningEntry(
  entries: SyncStatusEntry[] | null,
  source: SyncStatusEntry['source'],
): SyncStatusEntry | null {
  return entries?.find((entry) => entry.source === source && entry.state === 'running') ?? null;
}

export function firstSyncBannerFor(
  entries: SyncStatusEntry[] | null,
  rows: RowGame[],
): FirstSyncBannerModel | null {
  const meta = runningEntry(entries, 'meta');
  if (meta === null || !rows.some((row) => rowBadges(row).filling)) {
    return null;
  }
  return { n: rows.length, done: meta.progress.done, total: meta.progress.total };
}

/** 결정 C — 보유 목록 수집 중이고 행이 0개면 빈 상태 대신 로딩 스켈레톤. */
export function showOwnedSkeleton(entries: SyncStatusEntry[] | null, rowCount: number): boolean {
  return rowCount === 0 && runningEntry(entries, 'owned') !== null;
}

/** 결정 B — meta·owned가 running에서 정착하는 순간 1회 재조회(진입 시점 이후 전이만). */
export function shouldRefetchOnSettle(
  previous: SyncStatusEntry[] | null,
  next: SyncStatusEntry[] | null,
): boolean {
  if (previous === null || next === null) {
    return false;
  }
  return (['meta', 'owned'] as const).some(
    (source) => runningEntry(previous, source) !== null && runningEntry(next, source) === null,
  );
}
