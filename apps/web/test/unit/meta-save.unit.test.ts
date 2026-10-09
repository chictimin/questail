import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameMeta, MetaFetchResult } from '@questail/core';
import { saveCollectedMeta } from '../../src/data/meta.js';

/**
 * saveCollectedMeta 단위 테스트. fetch 없음 — MetaFetchResult를 직접 준다.
 * DB는 제품 drizzle 저널대로 만든다. 실 Steam 호출 0.
 * mkdtemp 고유 접두 사용.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freshDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'questail-meta-persist-'));
  const db = new Database(join(dir, 'questail.db'));
  db.pragma('journal_mode = WAL');
  const journal = JSON.parse(
    readFileSync(join(WEB, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  for (const entry of journal.entries) {
    db.exec(readFileSync(join(WEB, 'drizzle', `${entry.tag}.sql`), 'utf8'));
  }
  return db;
}

function seedGame(db: Database.Database, externalId: string, name: string | null = null): void {
  db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run(
    'steam',
    externalId,
    name,
  );
}

/** meta_states·game_genres FK용 run 행. id를 돌려준다. */
function seedRun(db: Database.Database): number {
  const row = db
    .prepare(
      "INSERT INTO sync_runs (source, status, started_at, observed_day, is_finalized) VALUES ('meta', 'running', 1, '2026-10-09', 0) RETURNING id",
    )
    .get() as { id: number };
  return row.id;
}

function metaResult(meta: GameMeta, state: MetaFetchResult['state']): MetaFetchResult {
  return { meta, state, fromCache: false };
}

const KEY = { platform: 'steam', externalId: '990081' };

function enOpts(db: Database.Database): { locale: 'en'; observedAt: number; syncRunId: number } {
  return { locale: 'en', observedAt: 1700000001, syncRunId: seedRun(db) };
}

function koOpts(db: Database.Database): { locale: 'ko'; observedAt: number; syncRunId: number } {
  return { locale: 'ko', observedAt: 1700000002, syncRunId: seedRun(db) };
}

function fullMeta(): GameMeta {
  return {
    appId: '990081',
    name: 'Meta Persist Game',
    genres: [{ id: '1', name: 'Action', nameKo: null }],
    developers: ['Dev Studio'],
    headerImage: 'http://127.0.0.1:9/cover.jpg',
    releaseDate: '2024-03-01',
    releaseDateRaw: 'Mar 1, 2024',
  };
}

describe('saveCollectedMeta', () => {
  it('ready en은 이름·커버·개발사·출시일·장르·ready를 기록한다', () => {
    const db = freshDb();
    try {
      seedGame(db, '990081');
      saveCollectedMeta(db, KEY, metaResult(fullMeta(), 'ready'), enOpts(db));
      expect(
        db.prepare('SELECT name, cover_url, developer_raw, release_date, release_date_text FROM games').get(),
      ).toEqual({
        name: 'Meta Persist Game',
        cover_url: 'http://127.0.0.1:9/cover.jpg',
        developer_raw: '["Dev Studio"]',
        release_date: Date.UTC(2024, 2, 1) / 1000,
        release_date_text: 'Mar 1, 2024',
      });
      expect(
        db.prepare('SELECT genre_id, genre_name_en, genre_name_ko, position, observed_at, sync_run_id FROM game_genres').all(),
      ).toEqual([
        {
          genre_id: '1',
          genre_name_en: 'Action',
          genre_name_ko: null,
          position: 0,
          observed_at: 1700000001,
          sync_run_id: 1,
        },
      ]);
      expect(db.prepare('SELECT state FROM meta_states').get()).toEqual({ state: 'ready' });
    } finally {
      db.close();
    }
  });

  it('en refresh는 titleKo·장르 ko칸을 보존한다', () => {
    const db = freshDb();
    try {
      db.prepare(
        'INSERT INTO games (platform, external_id, name, title_ko) VALUES (?, ?, ?, ?)',
      ).run('steam', '990081', 'Old Name', '옛 이름');
      db.prepare(
        'INSERT INTO game_genres (platform, external_id, genre_id, genre_name_en, genre_name_ko, position, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('steam', '990081', '1', 'Old Action', '액션', 0, 1);
      saveCollectedMeta(db, KEY, metaResult(fullMeta(), 'ready'), enOpts(db));
      expect(db.prepare('SELECT title_ko FROM games').get()).toEqual({ title_ko: '옛 이름' });
      expect(db.prepare('SELECT genre_name_en, genre_name_ko FROM game_genres').get()).toEqual({
        genre_name_en: 'Action',
        genre_name_ko: '액션',
      });
    } finally {
      db.close();
    }
  });

  it('ko는 titleKo·장르 ko칸만 갱신하고 en을 보존한다', () => {
    const db = freshDb();
    try {
      db.prepare(
        'INSERT INTO games (platform, external_id, name, title_ko) VALUES (?, ?, ?, ?)',
      ).run('steam', '990081', 'Old Name', '옛 이름');
      db.prepare(
        'INSERT INTO game_genres (platform, external_id, genre_id, genre_name_en, genre_name_ko, position, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('steam', '990081', '1', 'Action', null, 0, 1);
      const ko: GameMeta = {
        appId: '990081',
        name: '메타 게임',
        nameKo: '메타 게임',
        genres: [{ id: '1', name: '액션', nameKo: '액션' }],
      };
      saveCollectedMeta(
        db,
        KEY,
        metaResult(ko, 'ready'),
        koOpts(db),
      );
      expect(db.prepare('SELECT name, title_ko FROM games').get()).toEqual({
        name: 'Old Name',
        title_ko: '메타 게임',
      });
      expect(db.prepare('SELECT genre_name_en, genre_name_ko FROM game_genres').get()).toEqual({
        genre_name_en: 'Action',
        genre_name_ko: '액션',
      });
    } finally {
      db.close();
    }
  });

  it('ko 첫 수집은 en NULL 행을 만든다(0003 전제)', () => {
    const db = freshDb();
    try {
      seedGame(db, '990081');
      const ko: GameMeta = {
        appId: '990081',
        name: '메타 게임',
        nameKo: '메타 게임',
        genres: [{ id: '1', name: '액션', nameKo: '액션' }],
      };
      saveCollectedMeta(
        db,
        KEY,
        metaResult(ko, 'ready'),
        koOpts(db),
      );
      expect(db.prepare('SELECT genre_name_en, genre_name_ko FROM game_genres').get()).toEqual({
        genre_name_en: null,
        genre_name_ko: '액션',
      });
      expect(db.prepare('SELECT name, title_ko FROM games').get()).toEqual({
        name: null,
        title_ko: '메타 게임',
      });
      expect(db.prepare('SELECT state FROM meta_states').get()).toEqual({ state: 'ready' });
    } finally {
      db.close();
    }
  });

  it('empty는 games 보존·장르 삭제·empty를 기록한다', () => {
    const db = freshDb();
    try {
      db.prepare(
        'INSERT INTO games (platform, external_id, name, cover_url) VALUES (?, ?, ?, ?)',
      ).run('steam', '990081', 'Owned Name', 'http://127.0.0.1:9/old.jpg');
      db.prepare(
        'INSERT INTO game_genres (platform, external_id, genre_id, genre_name_en, position, observed_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('steam', '990081', '1', 'Action', 0, 1);
      saveCollectedMeta(
        db,
        KEY,
        metaResult({ appId: '990081', genres: [] }, 'empty'),
        enOpts(db),
      );
      expect(db.prepare('SELECT name, cover_url FROM games').get()).toEqual({
        name: 'Owned Name',
        cover_url: 'http://127.0.0.1:9/old.jpg',
      });
      expect(db.prepare('SELECT COUNT(*) AS n FROM game_genres').get()).toEqual({ n: 0 });
      expect(db.prepare('SELECT state FROM meta_states').get()).toEqual({ state: 'empty' });
    } finally {
      db.close();
    }
  });

  it('failed는 전부 보존·failed만 기록한다', () => {
    const db = freshDb();
    try {
      db.prepare(
        'INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)',
      ).run('steam', '990081', 'Owned Name');
      db.prepare(
        'INSERT INTO game_genres (platform, external_id, genre_id, genre_name_en, position, observed_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('steam', '990081', '1', 'Action', 0, 1);
      saveCollectedMeta(db, KEY, metaResult({ appId: '990081', genres: [] }, 'failed'), enOpts(db));
      expect(db.prepare('SELECT name FROM games').get()).toEqual({ name: 'Owned Name' });
      expect(db.prepare('SELECT COUNT(*) AS n FROM game_genres').get()).toEqual({ n: 1 });
      expect(db.prepare('SELECT state FROM meta_states').get()).toEqual({ state: 'failed' });
    } finally {
      db.close();
    }
  });

  it('games 행 없으면 throw한다', () => {
    const db = freshDb();
    try {
      expect(() => saveCollectedMeta(db, KEY, metaResult(fullMeta(), 'ready'), enOpts(db))).toThrow();
      expect(db.prepare('SELECT COUNT(*) AS n FROM game_genres').get()).toEqual({ n: 0 });
      expect(db.prepare('SELECT COUNT(*) AS n FROM meta_states').get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });

  it('빈 developers 배열은 "[]"로 저장하고 변환 불가 releaseDate는 정수를 보존한다', () => {
    const db = freshDb();
    try {
      db.prepare(
        'INSERT INTO games (platform, external_id, name, release_date, release_date_text) VALUES (?, ?, ?, ?, ?)',
      ).run('steam', '990081', 'g', 1700000000, 'Old text');
      const meta: GameMeta = {
        appId: '990081',
        name: 'g',
        developers: [],
        releaseDate: 'not-a-date',
        releaseDateRaw: 'Soon',
      };
      saveCollectedMeta(db, KEY, metaResult(meta, 'ready'), enOpts(db));
      expect(db.prepare('SELECT developer_raw, release_date, release_date_text FROM games').get()).toEqual({
        developer_raw: '[]',
        release_date: 1700000000,
        release_date_text: 'Soon',
      });
    } finally {
      db.close();
    }
  });
});
