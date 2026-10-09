import { describe, expect, it } from 'vitest';
import type { SyncStatusEntry } from '../../src/data/sync.js';
import { summaryModelFor } from '../../src/ui/shell/SummaryPill.js';

function entry(overrides: Partial<SyncStatusEntry>): SyncStatusEntry {
  return {
    source: 'owned',
    state: 'idle',
    runId: null,
    generation: 0,
    progress: { done: 0, total: null, source: 'owned' },
    issue: null,
    lastFinishedAt: null,
    ...overrides,
  };
}

function metaEntry(
  overrides: Partial<SyncStatusEntry> = {},
): SyncStatusEntry {
  return entry({
    source: 'meta',
    progress: { done: 412, total: 1284, source: 'meta' },
    ...overrides,
  });
}

describe('summaryModelFor', () => {
  it('null → 숨김', () => {
    expect(summaryModelFor(null)).toBeNull();
  });

  it('running meta → run + 수치', () => {
    expect(
      summaryModelFor([metaEntry({ state: 'running' })]),
    ).toEqual({ kind: 'run', done: 412, total: 1284 });
  });

  it('ok meta → done + 수치', () => {
    expect(summaryModelFor([metaEntry({ state: 'ok' })])).toEqual({
      kind: 'done',
      done: 412,
      total: 1284,
    });
  });

  it('어느 소스든 AUTH_INVALID_KEY → fail', () => {
    expect(
      summaryModelFor([
        metaEntry({ state: 'ok' }),
        entry({
          source: 'owned',
          state: 'failed',
          issue: { code: 'AUTH_INVALID_KEY', params: {} },
        }),
      ]),
    ).toEqual({ kind: 'fail' });
  });

  it('다른 소스 실패는 반영 안 함', () => {
    expect(
      summaryModelFor([
        metaEntry({ state: 'ok' }),
        entry({
          source: 'owned',
          state: 'failed',
          issue: { code: 'RATE_LIMITED', params: {} },
        }),
      ]),
    ).toEqual({ kind: 'done', done: 412, total: 1284 });
  });

  it('total null·run 없음 → 숨김', () => {
    expect(
      summaryModelFor([metaEntry({ state: 'running', progress: { done: 0, total: null, source: 'meta' } })]),
    ).toBeNull();
    expect(summaryModelFor([entry({ source: 'meta' })])).toBeNull();
  });
});
