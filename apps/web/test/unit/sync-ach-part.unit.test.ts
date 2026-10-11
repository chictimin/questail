import { describe, expect, it } from 'vitest';
import type { SyncStatusEntry } from '../../src/data/sync.js';
import type { CollectSource } from '../../src/data/syncRuns.js';
import { rowViewFor } from '../../src/ui/sync/models.js';

/** ACH-PART: 업적 부분 실패(failedItems) 게임 단위 문장. */
function makeEntry(
  overrides?: Partial<SyncStatusEntry> & { source?: CollectSource },
): SyncStatusEntry {
  return {
    source: 'achievements',
    state: 'idle',
    runId: null,
    generation: 1,
    lastFinishedAt: null,
    progress: { done: 0, total: null, source: 'achievements' },
    issue: null,
    ...overrides,
  } as SyncStatusEntry;
}

describe('업적 부분 실패 문장', () => {
  it('ok + failedItems 2 → causeAchievementsPart {n:2}·hold·재수집·시각', () => {
    const view = rowViewFor(
      makeEntry({ state: 'ok', lastFinishedAt: 1700000000, failedItems: 2 }),
    );
    expect(view.pill).toBe('hold');
    expect(view.retry).toBe(true);
    expect(view.time).toBe(1700000000);
    expect(view.body).toEqual({
      kind: 'cause',
      key: 'sync.causeAchievementsPart',
      params: { n: 2 },
    });
  });

  it('ok + failedItems 0 → 부분 실패 문장 없음', () => {
    const view = rowViewFor(
      makeEntry({ state: 'ok', lastFinishedAt: 1700000000, failedItems: 0 }),
    );
    expect(view.pill).not.toBe('hold');
    expect(view.body).not.toMatchObject({ key: 'sync.causeAchievementsPart' });
  });

  it('running + failedItems > 0 → 진행 표시(부분 실패 문장 없음)', () => {
    const view = rowViewFor(
      makeEntry({
        state: 'running',
        failedItems: 2,
        progress: { done: 3, total: 10, source: 'achievements' },
      }),
    );
    expect(view.pill).toBe('run');
    expect(view.body).not.toMatchObject({ key: 'sync.causeAchievementsPart' });
    expect(view.progress).toEqual({ pct: 30, label: '3/10' });
  });

  it('failed·issue → 원인 문장(부분 실패 아님)', () => {
    const view = rowViewFor(
      makeEntry({
        state: 'failed',
        failedItems: 2,
        issue: { code: 'ACCESS_PRIVATE', params: {} },
      }),
    );
    expect(view.pill).not.toBe('hold');
    expect(view.body).not.toMatchObject({ key: 'sync.causeAchievementsPart' });
    expect(view.body.kind).toBe('cause');
  });

  it('achievementsEnabled false → off 우선', () => {
    const view = rowViewFor(
      makeEntry({ state: 'ok', lastFinishedAt: 1700000000, failedItems: 2 }),
      false,
    );
    expect(view.pill).toBe('off');
    expect(view.body).toEqual({ kind: 'none' });
    expect(view.retry).toBe(false);
  });

  it('steamspy·meta 기존 키 유지', () => {
    const tags = rowViewFor(
      makeEntry({ source: 'steamspy', state: 'ok', failedItems: 5 }),
    );
    const info = rowViewFor(
      makeEntry({ source: 'meta', state: 'ok', failedItems: 7 }),
    );
    expect(tags.body).toMatchObject({ key: 'sync.causeTagsPart', params: { n: 5 } });
    expect(info.body).toMatchObject({ key: 'sync.causeInfoPart', params: { n: 7 } });
  });
});
