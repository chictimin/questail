import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateDatabase } from '../../src/db/migrate.js';

/**
 * 제품 0003 업그레이드 회귀 (MIGRATE-0003).
 * game_genres 재구성: 기존 행 보존·FK 위반 0·NULL 삽입 가능.
 * v1.5.9 이전 DB(=0000~0002 적용 상태)에 0003만 적용한다.
 * 0000~0002 파일 수정 없음 — 분리 폴더에 0003만 복사해 적용한다.
 */
function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'questail-dbc-'));
}

describe('db upgrade 0003', () => {
  it('0003 장르 재구성은 기존 행을 보존하고 en NULL을 허용한다', async () => {
    const dir = tmpDir();
    const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const names = readdirSync(join(webDir, 'drizzle'));
    const initial = names.filter((name) => /^(0000|0001|0002)_/.test(name)).sort();
    expect(initial).toHaveLength(3);
    const upgrade = names.find((name) => name.startsWith('0003_')) as string;
    const db = new Database(join(dir, 'questail.db'));
    try {
      for (const file of initial) {
        db.exec(readFileSync(join(webDir, 'drizzle', file), 'utf8'));
      }
      db.prepare("INSERT INTO games (platform, external_id, name) VALUES ('steam', '1', 'g')").run();
      db.prepare(
        'INSERT INTO game_genres (platform, external_id, genre_id, genre_name_en, genre_name_ko, position, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('steam', '1', '1', 'Action', '액션', 0, 1700000000);
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
        entries: [{ idx: 0, version: '6', when: 1728000000004, tag: upgrade.replace(/\.sql$/, ''), breakpoints: true }],
      }),
    );
    const handle = await migrateDatabase(dir, folder);
    try {
      const kept = handle.db
        .prepare(
          'SELECT platform, external_id, genre_id, genre_name_en, genre_name_ko, position, observed_at FROM game_genres',
        )
        .all();
      expect(kept).toEqual([
        {
          platform: 'steam',
          external_id: '1',
          genre_id: '1',
          genre_name_en: 'Action',
          genre_name_ko: '액션',
          position: 0,
          observed_at: 1700000000,
        },
      ]);
      expect(
        handle.db.prepare('SELECT * FROM pragma_foreign_key_check').all(),
      ).toEqual([]);
      handle.db
        .prepare(
          'INSERT INTO game_genres (platform, external_id, genre_id, genre_name_en, genre_name_ko, position, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('steam', '1', '2', null, '어드벤처', 1, 1700000001);
      expect(
        handle.db
          .prepare('SELECT genre_name_en, genre_name_ko FROM game_genres WHERE genre_id = ?')
          .get('2'),
      ).toEqual({ genre_name_en: null, genre_name_ko: '어드벤처' });
    } finally {
      await handle.close();
    }
  });
});
