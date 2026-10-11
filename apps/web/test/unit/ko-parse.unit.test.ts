import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { deriveForLocale, type AppDetailsData, type GameMeta, type MetaFetchResult } from '@questail/core';
import { saveCollectedMeta } from '../../src/data/meta.js';

/**
 * ko 응답 해석 — 출시일·장르 표기 (v1.5.13.6, 계약 「추가 테스트」 1~4).
 * 가짜 raw·합성 DB만 쓴다. 실 Steam 호출 0.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function raw(partial: Partial<AppDetailsData>): AppDetailsData {
  return { name: 'X', ...partial } as AppDetailsData;
}

function koDate(date: string): string | undefined {
  return deriveForLocale(raw({ release_date: { date } as never }), 'ko', '1').releaseDate;
}

function enDate(date: string): string | undefined {
  return deriveForLocale(raw({ release_date: { date } as never }), 'en', '1').releaseDate;
}

describe('core ko 출시일 (계약 추가 테스트 1)', () => {
  it('ko 형식을 YYYY-MM-DD로 변환한다(월·일 0 채움, 공백 유무 무관)', () => {
    expect(koDate('2009년 11월 16일')).toBe('2009-11-16');
    expect(koDate('2009년 1월 9일')).toBe('2009-01-09');
    expect(koDate('2009년11월16일')).toBe('2009-11-16');
  });

  it('연도만·연월만·빈 문자열·그 외 문구는 undefined', () => {
    for (const text of ['2026년', '2026년 3월', '', '발표 예정']) {
      expect(koDate(text)).toBeUndefined();
    }
  });

  it('범위 밖 월·일은 undefined, 2월 31일은 영문 규칙처럼 받는다', () => {
    expect(koDate('2009년 13월 1일')).toBeUndefined();
    expect(koDate('2009년 0월 1일')).toBeUndefined();
    expect(koDate('2009년 1월 0일')).toBeUndefined();
    expect(koDate('2009년 1월 32일')).toBeUndefined();
    expect(koDate('2009년 2월 31일')).toBe('2009-02-31');
  });

  it('원문은 releaseDateRaw에 그대로 남는다', () => {
    const meta = deriveForLocale(raw({ release_date: { date: '2009년 11월 16일' } as never }), 'ko', '1');
    expect(meta.releaseDateRaw).toBe('2009년 11월 16일');
  });

  it('en 회귀: 미국식 두 형식·영국식은 기존 결과 그대로', () => {
    expect(enDate('Oct 10, 2007')).toBe('2007-10-10');
    expect(enDate('October 10, 2007')).toBe('2007-10-10');
    expect(enDate('10 Oct, 2007')).toBe('2007-10-10');
  });
});

describe('core ko 장르·이름 (계약 추가 테스트 2·3)', () => {
  it('ko 응답 장르 description은 한글 여부와 무관하게 nameKo로 저장한다', () => {
    const meta = deriveForLocale(
      raw({
        genres: [
          { id: '3', description: 'RPG' },
          { id: '1', description: '액션' },
          { id: '2', description: '' },
        ],
      }),
      'ko',
      '1',
    );
    expect(meta.genres).toEqual([
      { id: '3', name: 'RPG', nameKo: 'RPG' },
      { id: '1', name: '액션', nameKo: '액션' },
    ]);
  });

  it('en 응답 장르는 nameKo null', () => {
    const meta = deriveForLocale(raw({ genres: [{ id: '3', description: 'RPG' }] }), 'en', '1');
    expect(meta.genres).toEqual([{ id: '3', name: 'RPG', nameKo: null }]);
  });

  it('게임 이름: ko 응답 영문 이름은 nameKo 없음, 한글 이름은 그대로', () => {
    expect(deriveForLocale(raw({ name: 'Half-Life' }), 'ko', '1').nameKo).toBeUndefined();
    expect(deriveForLocale(raw({ name: '하프라이프' }), 'ko', '1').nameKo).toBe('하프라이프');
  });
});

describe('web meta 저장 (계약 추가 테스트 4)', () => {
  function freshDb(): Database.Database {
    const dir = mkdtempSync(join(tmpdir(), 'questail-ko-parse-'));
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

  const KEY = { platform: 'steam', externalId: '990081' };

  function koOpts(db: Database.Database): { locale: 'ko'; observedAt: number; syncRunId: number } {
    const run = db
      .prepare(
        "INSERT INTO sync_runs (source, status, started_at, observed_day, is_finalized) VALUES ('meta', 'running', 1, '2026-10-09', 0) RETURNING id",
      )
      .get() as { id: number };
    return { locale: 'ko', observedAt: 1700000002, syncRunId: run.id };
  }

  function koResult(meta: GameMeta): MetaFetchResult {
    return { meta, state: 'ready', fromCache: false };
  }

  function derive(data: Partial<AppDetailsData>): GameMeta {
    return deriveForLocale(raw(data), 'ko', '990081');
  }

  it('ko 응답 RPG → genre_name_ko RPG, genre_name_en은 기존값 보존(NULL이면 NULL)', () => {
    const db = freshDb();
    try {
      db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run('steam', '990081', null);
      saveCollectedMeta(db, KEY, koResult(derive({ genres: [{ id: '3', description: 'RPG' }] })), koOpts(db));
      expect(db.prepare('SELECT genre_name_en, genre_name_ko FROM game_genres').get()).toEqual({
        genre_name_en: null,
        genre_name_ko: 'RPG',
      });
    } finally {
      db.close();
    }
  });

  it('기존 ko값(롤플레잉)이 있어도 ko 응답 RPG로 갱신, en값 보존', () => {
    const db = freshDb();
    try {
      db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run('steam', '990081', null);
      db.prepare(
        'INSERT INTO game_genres (platform, external_id, genre_id, genre_name_en, genre_name_ko, position, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('steam', '990081', '3', 'RPG-en', '롤플레잉', 0, 1);
      saveCollectedMeta(db, KEY, koResult(derive({ genres: [{ id: '3', description: 'RPG' }] })), koOpts(db));
      expect(db.prepare('SELECT genre_name_en, genre_name_ko FROM game_genres').get()).toEqual({
        genre_name_en: 'RPG-en',
        genre_name_ko: 'RPG',
      });
    } finally {
      db.close();
    }
  });

  it('ko 날짜 → games.release_date = UTC 자정 epoch', () => {
    const db = freshDb();
    try {
      db.prepare('INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)').run('steam', '990081', null);
      saveCollectedMeta(
        db,
        KEY,
        koResult(derive({ release_date: { date: '2009년 11월 16일' } as never })),
        koOpts(db),
      );
      expect(db.prepare('SELECT release_date, release_date_text FROM games').get()).toEqual({
        release_date: Date.UTC(2009, 10, 16) / 1000,
        release_date_text: '2009년 11월 16일',
      });
    } finally {
      db.close();
    }
  });
});
