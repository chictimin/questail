import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateDatabase } from '../../src/db/migrate.js';

/**
 * 제품 0001 업그레이드 회귀 (묶음B). 제품 drizzle 파일을 읽어
 * 기존 FK 행 보존을 확인한다. 묶음A 커밋만으로는 실행 불가라 분리한다.
 */
function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'questail-d04b-'));
}

/** 제품 테이블 행수·해시. 명시 보존 대상(P-4) */
function productSnapshot(dir: string): { counts: Record<string, number>; hash: string } {
  const db = new Database(join(dir, 'questail.db'), { readonly: true });
  try {
    const counts: Record<string, number> = {};
    for (const table of ['games', 'ownership_spans', 'ratings', 'game_user_tags']) {
      counts[table] = (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    }
    const rows = db
      .prepare(
        'SELECT platform, external_id, name FROM games ORDER BY external_id',
      )
      .all();
    const spans = db
      .prepare('SELECT platform, external_id, origin, started_at, ended FROM ownership_spans ORDER BY id')
      .all();
    return { counts, hash: createHash('sha256').update(JSON.stringify({ rows, spans })).digest('hex') };
  } finally {
    db.close();
  }
}

describe('db upgrade 0001', () => {
  it('0001 name 재구성은 기존 FK 행을 보존한다', async () => {
    const dir = tmpDir();
    const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const initial = readdirSync(join(webDir, 'drizzle')).find((name) =>
      name.startsWith('0000_'),
    ) as string;
    const upgrade = readdirSync(join(webDir, 'drizzle')).find((name) =>
      name.startsWith('0001_'),
    ) as string;
    const db = new Database(join(dir, 'questail.db'));
    try {
      db.exec(readFileSync(join(webDir, 'drizzle', initial), 'utf8'));
      db.prepare("INSERT INTO games (platform, external_id, name) VALUES ('steam', '1', 'g')").run();
      db.prepare(
        'INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('steam', '1', 'observed', 1700000000, 0, 1);
      db.prepare(
        "INSERT INTO ratings (platform, external_id, score, updated_at, updated_by) VALUES ('steam', '1', 8, 1, 'user')",
      ).run();
      db.prepare(
        'INSERT INTO game_user_tags (platform, external_id, tag, votes, rank, observed_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('steam', '1', 'RPG', 100, 1, 1700000000);
    } finally {
      db.close();
    }
    const before = productSnapshot(dir);
    const folder = join(dir, 'upgrade');
    mkdirSync(join(folder, 'meta'), { recursive: true });
    copyFileSync(join(webDir, 'drizzle', upgrade), join(folder, upgrade));
    writeFileSync(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [{ idx: 0, version: '6', when: 1728000000002, tag: upgrade.replace(/\.sql$/, ''), breakpoints: true }],
      }),
    );
    const handle = await migrateDatabase(dir, folder);
    try {
      expect(productSnapshot(dir)).toEqual(before);
    } finally {
      await handle.close();
    }
  });
});
