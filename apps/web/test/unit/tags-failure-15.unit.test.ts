import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveCollectedTags } from '../../src/data/tags.js';

/**
 * U3a #15 failed 사유 저장 테스트. 합성 DB(제품 SQL)만 쓴다. 실호출 없음.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = 1700000000;

function freshDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-u3atags-'));
  const journal = JSON.parse(
    readFileSync(join(WEB, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const setup = new Database(join(dir, 'questail.db'));
  try {
    for (const entry of journal.entries) {
      setup.exec(readFileSync(join(WEB, 'drizzle', `${entry.tag}.sql`), 'utf8'));
    }
  } finally {
    setup.close();
  }
  const db = new Database(join(dir, 'questail.db'));
  for (const externalId of ['990011', '990012']) {
    db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run(
      'steam',
      externalId,
      `g-${externalId}`,
    );
  }
  return { dir, db };
}

function sourceRow(db: Database.Database, externalId: string): unknown {
  return db
    .prepare(
      'SELECT tag_status, fail_reason, fail_status FROM tag_sources WHERE platform = ? AND external_id = ?',
    )
    .get('steam', externalId);
}

describe('saveCollectedTags 실패 사유', () => {
  it('failed http → fail_reason http·fail_status 보관', () => {
    const { dir, db } = freshDb();
    try {
      const out = saveCollectedTags(
        db,
        { platform: 'steam', externalId: '990011' },
        { status: 'failed', tags: [], failure: { reason: 'http', status: 500 } },
        { observedAt: NOW, syncRunId: null },
      );
      expect(out).toEqual({ status: 'failed' });
      expect(sourceRow(db, '990011')).toEqual({
        tag_status: 'failed',
        fail_reason: 'http',
        fail_status: 500,
      });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('failed corrupt → fail_reason corrupt·fail_status NULL', () => {
    const { dir, db } = freshDb();
    try {
      saveCollectedTags(
        db,
        { platform: 'steam', externalId: '990011' },
        { status: 'failed', tags: [], failure: { reason: 'corrupt' } },
        { observedAt: NOW, syncRunId: null },
      );
      expect(sourceRow(db, '990011')).toEqual({
        tag_status: 'failed',
        fail_reason: 'corrupt',
        fail_status: null,
      });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ready·empty 전환 시 둘 다 NULL + 다른 게임 과거 행 무변경', () => {
    const { dir, db } = freshDb();
    try {
      db.prepare(
        "INSERT INTO tag_sources (platform, external_id, tag_status, observed_at, sync_run_id, fail_reason, fail_status) VALUES ('steam', '990011', 'failed', 1, NULL, 'http', 500)",
      ).run();
      db.prepare(
        "INSERT INTO tag_sources (platform, external_id, tag_status, observed_at, sync_run_id, fail_reason, fail_status) VALUES ('steam', '990012', 'failed', 1, NULL, 'corrupt', NULL)",
      ).run();
      saveCollectedTags(
        db,
        { platform: 'steam', externalId: '990011' },
        { status: 'ready', tags: [{ tag: 'A', votes: 9 }] },
        { observedAt: NOW, syncRunId: null },
      );
      expect(sourceRow(db, '990011')).toEqual({
        tag_status: 'ready',
        fail_reason: null,
        fail_status: null,
      });
      expect(sourceRow(db, '990012')).toEqual({
        tag_status: 'failed',
        fail_reason: 'corrupt',
        fail_status: null,
      });
      saveCollectedTags(
        db,
        { platform: 'steam', externalId: '990011' },
        { status: 'empty', tags: [] },
        { observedAt: NOW, syncRunId: null },
      );
      expect(sourceRow(db, '990011')).toEqual({
        tag_status: 'empty',
        fail_reason: null,
        fail_status: null,
      });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
