import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateDatabase } from '../../src/db/migrate.js';

/**
 * 제품 0004 업그레이드 회귀 (U3a #15).
 * tag_sources fail_reason·fail_status 추가 + 현 세대 실패 체크포인트만 삭제.
 * 0000~0003 적용 상태에 0004만 적용한다. 0000~0004 파일 수정 없음 — 분리 폴더에 0004만 복사해 적용한다.
 */
function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'questail-dbc-'));
}

describe('db upgrade 0004', () => {
  it('실패 체크포인트(현 세대 steamspy·meta)만 삭제·성공·이전 세대 유지', async () => {
    const dir = tmpDir();
    const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const names = readdirSync(join(webDir, 'drizzle'));
    const initial = names.filter((name) => /^(0000|0001|0002|0003)_/.test(name)).sort();
    expect(initial).toHaveLength(4);
    const upgrade = names.find((name) => name.startsWith('0004_')) as string;
    const db = new Database(join(dir, 'questail.db'));
    try {
      for (const file of initial) {
        db.exec(readFileSync(join(webDir, 'drizzle', file), 'utf8'));
      }
      db.exec(
        "INSERT INTO sync_generations (source, generation) VALUES ('steamspy', 2), ('meta', 2), ('achievements', 2)",
      );
      for (const id of ['1', '2', '3']) {
        db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run(
          'steam',
          id,
          `g-${id}`,
        );
      }
      db.exec(
        "INSERT INTO tag_sources (platform, external_id, tag_status, observed_at, sync_run_id) VALUES ('steam', '1', 'failed', 1, NULL), ('steam', '2', 'ready', 1, NULL)",
      );
      db.exec(
        "INSERT INTO meta_states (platform, external_id, state, observed_at, sync_run_id) VALUES ('steam', '1', 'failed', 1, NULL), ('steam', '3', 'ready', 1, NULL)",
      );
      db.exec(
        "INSERT INTO achievement_states (platform, external_id, state, observed_at, sync_run_id) VALUES ('steam', '2', 'failed', 1, NULL)",
      );
      db.exec(
        `INSERT INTO checkpoints (generation, source, item_key, done_at, sync_run_id) VALUES
          (2, 'steamspy', 'steam:1:steamspy', 1, NULL),
          (2, 'steamspy', 'steam:2:steamspy', 1, NULL),
          (1, 'steamspy', 'steam:1:steamspy', 1, NULL),
          (2, 'meta', 'steam:1:meta', 1, NULL),
          (2, 'meta', 'steam:3:meta', 1, NULL),
          (2, 'achievements', 'steam:2:achievements', 1, NULL),
          (2, 'achievements', 'steam:1:achievements', 1, NULL)`,
      );
    } finally {
      db.close();
    }
    const folder = join(dir, 'upgrade');
    mkdirSync(join(folder, 'meta'), { recursive: true });
    copyFileSync(join(webDir, 'drizzle', upgrade), join(folder, upgrade));
    writeFileSync(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [{ idx: 0, version: '6', when: 1728000000005, tag: upgrade.replace(/\.sql$/, ''), breakpoints: true }],
      }),
    );
    const handle = await migrateDatabase(dir, folder);
    try {
      const cols = handle.db
        .prepare('PRAGMA table_info(tag_sources)')
        .all() as { name: string }[];
      expect(cols.map((c) => c.name)).toContain('fail_reason');
      expect(cols.map((c) => c.name)).toContain('fail_status');
      const left = handle.db
        .prepare('SELECT generation AS g, source AS s, item_key AS k FROM checkpoints ORDER BY s, k')
        .all();
      expect(left).toEqual([
        { g: 2, s: 'achievements', k: 'steam:1:achievements' },
        { g: 2, s: 'meta', k: 'steam:3:meta' },
        { g: 1, s: 'steamspy', k: 'steam:1:steamspy' },
        { g: 2, s: 'steamspy', k: 'steam:2:steamspy' },
      ]);
      expect(handle.db.prepare('SELECT * FROM pragma_foreign_key_check').all()).toEqual([]);
    } finally {
      await handle.close();
    }
  });
});
