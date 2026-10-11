import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSyncService } from '../../src/data/service.js';
import { resetSyncLocksForTest } from '../../src/data/sync.js';
import { createJobExecutor } from '../../src/jobs/collect.js';
import type { FetchLike } from '../../src/data/connection.js';

/**
 * 반례 테스트 (R1-FIX-SRV D16-small ②).
 * achievements run 정상 종료 → sync_runs.failed_items 0 +
 * SyncStatusEntry.failedItems 키 없음. meta·steamspy는 그대로.
 * itemCount는 741행 식 그대로(total).
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY = '0123456789abcdef0123456789abcdef';
const SID = '76561197960287930';
const BASE = 'http://127.0.0.1:9/';

function freshDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'questail-zz-ach-'));
  const db = new Database(join(dir, 'questail.db'));
  db.pragma('journal_mode = WAL');
  const journal = JSON.parse(
    readFileSync(join(WEB, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  for (const entry of journal.entries) {
    db.exec(readFileSync(join(WEB, 'drizzle', `${entry.tag}.sql`), 'utf8'));
  }
  resetSyncLocksForTest();
  return db;
}

async function settled(service: ReturnType<typeof createSyncService>): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const rows = service.getSyncStatus();
    if (rows.every((row) => row.state !== 'running')) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('drain 시간 초과');
}

describe('반례: achievements failedItems NULL', () => {
  it('업적 run 정상 종료 → failed_items 0·entry 키 있음·itemCount=total', async () => {
    const db = freshDb();
    const dir = mkdtempSync(join(tmpdir(), 'questail-zz-ach-'));
    try {
      db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run(
        'steam',
        '990011',
        'g-990011',
      );
      db.prepare(
        'INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('steam', '990011', 'observed', 1700000000, 0, 0);
      writeFileSync(join(dir, 'steam.key'), KEY, { mode: 0o600 });
      db.prepare('INSERT INTO account (id, steam_id, created_at) VALUES (1, ?, 1)').run(SID);
      db.prepare("INSERT INTO preferences (key, value, updated_at) VALUES ('achievement_enabled', '1', 1)").run();
      const fetchFn: FetchLike = async () => ({
        status: 200,
        json: async () => ({
          playerstats: { success: true, achievements: [{ apiname: 'a1', achieved: 1, unlocktime: 5 }] },
        }),
      });
      const service = createSyncService({
        db,
        keyPath: join(dir, 'steam.key'),
        cacheDir: join(dir, 'cache'),
        baseUrl: BASE,
        fetchFn,
        timeZone: 'Asia/Seoul',
        executor: (ctx) => createJobExecutor(ctx),
      });
      const first = service.startSync({ sources: ['achievements'], locale: 'ko' });
      expect(typeof first).toBe('number');
      const runId = first as number;
      await settled(service);
      const row = db
        .prepare('SELECT status AS s, item_count AS c, failed_items AS n FROM sync_runs WHERE id = ?')
        .get(runId) as { s: string; c: number; n: number | null };
      expect(row.s).toBe('ok');
      expect(row.c).toBe(1);
      expect(row.n).toBe(0);
      const entry = service.getSyncStatus().find((r) => r.source === 'achievements');
      expect(entry?.state).toBe('ok');
      expect('failedItems' in (entry as object)).toBe(true);
    } finally {
      db.close();
      resetSyncLocksForTest();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
