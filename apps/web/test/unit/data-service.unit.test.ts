import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyncService } from '../../src/data/service.js';
import { resetSyncLocksForTest } from '../../src/data/sync.js';

/**
 * D-08 서비스 래퍼 테스트. 가짜 executor로 상태·전이·공유를 확인한다.
 * 실키·실행 없음. D06 제품 실행과 분리한다.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freshService() {
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
  const service = createSyncService({
    db,
    keyPath: join(dir, 'steam.key'),
    cacheDir: join(dir, 'cache'),
    executor: { kind: 'fake' },
  });
  return { db, service };
}

describe('data service', () => {
  it('같은 instance가 락·세대를 공유한다', () => {
    const { db, service } = freshService();
    try {
      const other = createSyncService({
        db,
        keyPath: join(tmpdir(), 'steam.key'),
        cacheDir: join(tmpdir(), 'cache'),
      });
      const id = service.startSync({ sources: ['owned'], locale: 'ko' });
      expect(typeof id).toBe('number');
      expect(other.startSync({ sources: ['owned'], locale: 'ko' })).toEqual({
        code: 'SYNC_IN_PROGRESS',
        source: 'owned',
      });
      expect(other.resyncSource('wishlist', { locale: 'ko' })).not.toEqual({
        code: 'SYNC_IN_PROGRESS',
        source: 'wishlist',
      });
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });

  it('별도 DB는 동시에 수락한다', () => {
    const first = freshService();
    const second = freshService();
    try {
      expect(first.service.startSync({ sources: ['owned'], locale: 'ko' })).not.toEqual({
        code: 'SYNC_IN_PROGRESS',
        source: 'owned',
      });
      expect(second.service.startSync({ sources: ['owned'], locale: 'ko' })).not.toEqual({
        code: 'SYNC_IN_PROGRESS',
        source: 'owned',
      });
    } finally {
      first.db.close();
      second.db.close();
      resetSyncLocksForTest();
    }
  });

  it('전이 완료·구세대 거부를 처리한다', () => {
    const { db, service } = freshService();
    try {
      const id = service.startSync({ sources: ['meta'], locale: 'en' }) as number;
      expect(service.progressRun(id, 'meta', { done: 1, total: 3 })).toBe(true);
      expect(
        service.finishSyncRun(id, 'meta', {
          status: 'failed',
          finishedAt: 1700000001,
          itemCount: 1,
          isFinalized: true,
          issue: { code: 'RATE_LIMITED', params: {} },
        }),
      ).toBe(true);
      expect(
        service.finishSyncRun(id, 'meta', {
          status: 'ok',
          finishedAt: 1700000002,
          itemCount: 1,
          isFinalized: true,
          issue: null,
        }),
      ).toBe(false);
      const status = service.getSyncStatus().find((row) => row.source === 'meta');
      expect(status).toMatchObject({ state: 'failed', lastFinishedAt: 1700000001 });
      expect(status?.issue).toEqual({ code: 'RATE_LIMITED', params: {} });
    } finally {
      db.close();
      resetSyncLocksForTest();
    }
  });
});
