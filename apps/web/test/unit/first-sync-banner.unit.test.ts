import { describe, expect, it } from 'vitest';
import type { GameFacts } from '../../src/data/library.js';
import type { SyncStatusEntry } from '../../src/data/sync.js';
import type { RowGame } from '../../src/ui/library/GameRow.js';
import {
  firstSyncBannerFor,
  shouldRefetchOnSettle,
  showOwnedSkeleton,
} from '../../src/ui/library/bannerState.js';

type Source = SyncStatusEntry['source'];

function entry(
  source: Source,
  state: SyncStatusEntry['state'],
  progress: { done: number; total: number | null } = { done: 0, total: null },
): SyncStatusEntry {
  return {
    source,
    state,
    runId: null,
    generation: 1,
    lastFinishedAt: null,
    progress: { ...progress, source },
    issue: null,
  };
}

function row(filled: boolean, id = '1'): RowGame {
  return {
    key: { platform: 'steam', externalId: id },
    name: 'Game',
    titleKo: null,
    developerRaw: null,
    releaseDate: null,
    releaseDateText: null,
    genres: filled ? ['Action'] : [],
    coverUrl: filled ? 'https://example.test/c.jpg' : null,
    hidden: false,
    libraryAddedAt: null,
    confirmedMinutes: 0,
    lastPlayed: null,
    snapshots: [],
    deltas: [],
    coverage: { firstObservedAt: null, lastObservedAt: null, gapDays: [], isBaseline: false },
    ownership: [
      { origin: 'observed', startedAt: 1700000000, ended: false, endedAt: null, isBaseline: false, syncRunId: null },
    ],
  } as unknown as RowGame & GameFacts;
}

describe('firstSyncBannerFor', () => {
  it('meta running + 보충 중 행 1개 이상 → 모델(n은 전체 행 수)', () => {
    const model = firstSyncBannerFor(
      [entry('meta', 'running', { done: 412, total: 1284 })],
      [row(true, '1'), row(false, '2')],
    );
    expect(model).toEqual({ n: 2, done: 412, total: 1284 });
  });

  it('total null도 통과한다', () => {
    const model = firstSyncBannerFor([entry('meta', 'running')], [row(false)]);
    expect(model).toEqual({ n: 1, done: 0, total: null });
  });

  it('meta가 running이 아니면 null', () => {
    expect(firstSyncBannerFor([entry('meta', 'ok')], [row(false)])).toBeNull();
  });

  it('보충 중 행이 0개면 null', () => {
    expect(firstSyncBannerFor([entry('meta', 'running')], [row(true)])).toBeNull();
  });

  it('meta가 아닌 소스만 running이거나 entries가 null이면 null', () => {
    expect(firstSyncBannerFor([entry('owned', 'running')], [row(false)])).toBeNull();
    expect(firstSyncBannerFor(null, [row(false)])).toBeNull();
  });
});

describe('showOwnedSkeleton', () => {
  it('owned running + 행 0개 → 스켈레톤', () => {
    expect(showOwnedSkeleton([entry('owned', 'running')], 0)).toBe(true);
  });

  it('owned 정착 후 행 0개 → 기존 빈 상태', () => {
    expect(showOwnedSkeleton([entry('owned', 'ok')], 0)).toBe(false);
  });

  it('행이 있으면 owned running이어도 스켈레톤 아님', () => {
    expect(showOwnedSkeleton([entry('owned', 'running')], 3)).toBe(false);
    expect(showOwnedSkeleton(null, 0)).toBe(false);
  });
});

describe('shouldRefetchOnSettle', () => {
  it('meta running → ok 전이에서만 true', () => {
    expect(shouldRefetchOnSettle([entry('meta', 'running')], [entry('meta', 'ok')])).toBe(true);
  });

  it('owned running → 정착 전이도 true', () => {
    expect(shouldRefetchOnSettle([entry('owned', 'running')], [entry('owned', 'failed')])).toBe(true);
  });

  it('계속 running이거나 계속 정착이면 false(중복 조회 없음)', () => {
    expect(shouldRefetchOnSettle([entry('meta', 'running')], [entry('meta', 'running')])).toBe(false);
    expect(shouldRefetchOnSettle([entry('meta', 'ok')], [entry('meta', 'ok')])).toBe(false);
  });

  it('이전 값이 null이면 false', () => {
    expect(shouldRefetchOnSettle(null, [entry('meta', 'ok')])).toBe(false);
  });
});
