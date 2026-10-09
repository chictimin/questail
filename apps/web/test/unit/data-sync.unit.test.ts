import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppMetaRateLimitedError } from '@questail/core';
import {
  finishSyncRun,
  getSyncStatus,
  progressRun,
  rateLimitIssue,
  resetSyncLocksForTest,
  resyncSource,
  startSync,
} from '../../src/data/sync.js';

/**
 * D-08 동기 상태 테스트. 합성 DB에 제품 SQL을 적용하고
 * 락·상태·세대·실패 이슈를 확인한다. 잡·cron은 범위 밖.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freshDb(): Database.Database {
  resetSyncLocksForTest();
  const dir = mkdtempSync(join(tmpdir(), 'questail-d08-zolu-'));
  const journal = JSON.parse(
    readFileSync(join(WEB, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const db = new Database(join(dir, 'questail.db'));
  db.pragma('journal_mode = WAL');
  for (const entry of journal.entries) {
    db.exec(readFileSync(join(WEB, 'drizzle', `${entry.tag}.sql`), 'utf8'));
  }
  resetSyncLocksForTest();
  return db;
}

describe('data sync', () => {
  it('같은 소스 running 중 재요청은 코드를 낸다', () => {
    const db = freshDb();
    try {
      const first = startSync(db, { sources: ['owned'], locale: 'ko', timeZone: 'UTC' });
      expect(typeof first).toBe('number');
      expect(startSync(db, { sources: ['owned', 'wishlist'], locale: 'ko', timeZone: 'UTC' })).toEqual({
        code: 'SYNC_IN_PROGRESS',
        source: 'owned',
      });
      expect(resyncSource(db, 'wishlist', { locale: 'ko', timeZone: 'UTC' })).not.toEqual({
        code: 'SYNC_IN_PROGRESS',
        source: 'wishlist',
      });
      expect(resyncSource(db, 'owned', { locale: 'ko', timeZone: 'UTC' })).toEqual({
        code: 'SYNC_IN_PROGRESS',
        source: 'owned',
      });
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('완료하면 락이 풀리고 상태가 보인다', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1700000000000);
      const db = freshDb();
      try {
        const id = startSync(db, { locale: 'en', timeZone: 'UTC' }) as number;
        expect(getSyncStatus(db).find((row) => row.source === 'owned')).toMatchObject({
          state: 'running',
          runId: id,
          generation: 1,
          progress: { done: 0, total: null, source: 'owned' },
        });
        expect(
          finishSyncRun(db, id, 'owned', {
            status: 'ok',
            finishedAt: 1700000001,
            itemCount: 3,
            isFinalized: true,
            issue: null,
          }),
        ).toBe(true);
        expect(getSyncStatus(db).find((row) => row.source === 'meta')).toMatchObject({
          state: 'running',
        });
        vi.setSystemTime(1700000001000);
        expect(startSync(db, { sources: ['owned'], locale: 'en', timeZone: 'UTC' })).not.toEqual({
          code: 'SYNC_IN_PROGRESS',
          source: 'owned',
        });
      } finally {
        db.close();
        resetSyncLocksForTest();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('D07 typed 실패를 failed 이슈로 연결한다', () => {
    expect(rateLimitIssue(new AppMetaRateLimitedError(1000))).toEqual({
      code: 'RATE_LIMITED',
      params: {},
    });
  });

  it('구세대 progress·terminal은 거부하고 새 실행은 그대로다', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1700000000000);
      const db = freshDb();
      try {
        const oldId = startSync(db, { sources: ['owned'], locale: 'ko', timeZone: 'UTC' }) as number;
        expect(
          finishSyncRun(db, oldId, 'owned', {
            status: 'ok',
            finishedAt: 1700000001,
            itemCount: 1,
            isFinalized: true,
            issue: null,
          }),
        ).toBe(true);
        vi.setSystemTime(1700000001000);
        const newId = startSync(db, { sources: ['owned'], locale: 'ko', timeZone: 'UTC' }) as number;
        expect(progressRun(db, oldId, 'owned', { done: 9 })).toBe(false);
        expect(
          finishSyncRun(db, oldId, 'owned', {
            status: 'ok',
            finishedAt: 1700000002,
            itemCount: 1,
            isFinalized: true,
            issue: null,
          }),
        ).toBe(false);
        expect(progressRun(db, newId, 'owned', { done: 1, total: 2 })).toBe(true);
        expect(getSyncStatus(db).find((row) => row.source === 'owned')?.progress).toEqual({
          done: 1,
          total: 2,
          source: 'owned',
        });
      } finally {
        db.close();
        resetSyncLocksForTest();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('같은 초 종료·재시작이 충돌하지 않고 시각이 같다', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1700000000000);
      const db = freshDb();
      try {
        const first = startSync(db, { sources: ['owned'], locale: 'ko', timeZone: 'UTC' }) as number;
        expect(
          finishSyncRun(db, first, 'owned', {
            status: 'ok',
            finishedAt: 1700000000,
            itemCount: 1,
            isFinalized: true,
            issue: null,
          }),
        ).toBe(true);
        const second = startSync(db, { sources: ['owned'], locale: 'ko', timeZone: 'UTC' });
        expect(typeof second).toBe('number');
        const rows = db
          .prepare('SELECT started_at FROM sync_runs WHERE source = ? ORDER BY id')
          .all('owned') as { started_at: number }[];
        expect(rows.map((row) => row.started_at)).toEqual([1700000000, 1700000000]);
      } finally {
        db.close();
        resetSyncLocksForTest();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('failedItems 0·양수·null이 왕복한다', () => {
    const db = freshDb();
    try {
      const zero = startSync(db, { sources: ['meta'], locale: 'en', timeZone: 'UTC' }) as number;
      expect(
        finishSyncRun(db, zero, 'meta', {
          status: 'ok',
          finishedAt: 1700000001,
          itemCount: 1,
          isFinalized: true,
          issue: null,
          failedItems: 0,
        }),
      ).toBe(true);
      expect(
        getSyncStatus(db).find((row) => row.source === 'meta')?.failedItems,
      ).toBe(0);
      const positive = startSync(db, { sources: ['wishlist'], locale: 'en', timeZone: 'UTC' }) as number;
      expect(
        finishSyncRun(db, positive, 'wishlist', {
          status: 'ok',
          finishedAt: 1700000002,
          itemCount: 1,
          isFinalized: true,
          issue: null,
          failedItems: 3,
        }),
      ).toBe(true);
      expect(
        getSyncStatus(db).find((row) => row.source === 'wishlist')?.failedItems,
      ).toBe(3);
      const none = startSync(db, { sources: ['owned'], locale: 'en', timeZone: 'UTC' }) as number;
      expect(
        finishSyncRun(db, none, 'owned', {
          status: 'ok',
          finishedAt: 1700000003,
          itemCount: 1,
          isFinalized: true,
          issue: null,
        }),
      ).toBe(true);
      expect(
        getSyncStatus(db).find((row) => row.source === 'owned')?.failedItems,
      ).toBeUndefined();
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });
});
