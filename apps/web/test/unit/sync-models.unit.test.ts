import { describe, expect, it } from 'vitest';
import type { SyncStatusEntry } from '../../src/data/sync.js';
import type { CollectSource } from '../../src/data/syncRuns.js';
import { latestFinishedAt, rowViewFor } from '../../src/ui/sync/models.js';

/** U3b [2] 표시값 단위 테스트. 상단 시각·HELD_ZERO·failedItems·업적 OFF. */
function makeEntry(
  overrides?: Partial<SyncStatusEntry> & { source?: CollectSource },
): SyncStatusEntry {
  return {
    source: 'owned',
    state: 'idle',
    runId: null,
    generation: 1,
    lastFinishedAt: null,
    progress: { done: 0, total: null, source: 'owned' },
    issue: null,
    ...overrides,
  } as SyncStatusEntry;
}

describe('latestFinishedAt', () => {
  it('ok 소스 최댓값, 없으면 null', () => {
    const entries = [
      makeEntry({ source: 'owned', state: 'ok', lastFinishedAt: 1700000000 }),
      makeEntry({ source: 'wishlist', state: 'ok', lastFinishedAt: 1700100000 }),
      makeEntry({ source: 'meta', state: 'running', lastFinishedAt: 1700200000 }),
    ];
    expect(latestFinishedAt(entries, true)).toBe(1700100000);
    expect(latestFinishedAt([], true)).toBeNull();
  });

  it('업적 OFF면 업적 run 제외', () => {
    const entries = [
      makeEntry({ source: 'achievements', state: 'ok', lastFinishedAt: 1700999999 }),
      makeEntry({ source: 'owned', state: 'ok', lastFinishedAt: 1700000000 }),
    ];
    expect(latestFinishedAt(entries, false)).toBe(1700000000);
    expect(latestFinishedAt(entries, true)).toBe(1700999999);
  });
});

describe('rowViewFor', () => {
  it('HELD_ZERO {prev}=params.prev', () => {
    const view = rowViewFor(
      makeEntry({
        state: 'held',
        issue: { code: 'HELD_ZERO', params: { prev: 1284 } },
      }),
    );
    expect(view.pill).toBe('hold');
    expect(view.body).toEqual({
      kind: 'cause',
      key: 'sync.causeHeldZero',
      params: { prev: 1284 },
    });
    expect(view.retry).toBe(true);
  });

  it('failedItems {n} (0 초과만)', () => {
    const view = rowViewFor(
      makeEntry({ state: 'ok', lastFinishedAt: 1700000000, failedItems: 37 }),
    );
    expect(view.pill).toBe('hold');
    expect(view.body).toEqual({
      kind: 'cause',
      key: 'sync.causeInfoPart',
      params: { n: 37 },
    });
  });

  it('업적 OFF면 꺼짐 pill·시각 없음·재수집 없음', () => {
    const view = rowViewFor(
      makeEntry({ source: 'achievements', state: 'running', lastFinishedAt: 1700000000 }),
      false,
    );
    expect(view).toEqual({
      source: 'ach',
      time: null,
      pill: 'off',
      body: { kind: 'none' },
      retry: false,
    });
  });
});
