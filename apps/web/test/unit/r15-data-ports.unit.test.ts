import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TBTI_CODES, TBTI_NAMES } from '../../src/data/tbtiNames.js';
import { readAccountCreatedAt } from '../../src/data/account.js';
import {
  BUILTIN_SERIES_ALIASES,
  loadSeriesAliases,
} from '../../src/data/seriesAliases.js';

/** R15-8 이름 데이터 + readAccountCreatedAt + 별칭 로더 포트 테스트. */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freshDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-r15ports-'));
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
  return { dir, db: new Database(join(dir, 'questail.db')) };
}

describe('T4 tbtiNames', () => {
  it('16 코드 키와 필드(ko/en 쌍, en 본문 비움)를 갖는다', () => {
    expect(TBTI_CODES).toHaveLength(16);
    for (const code of TBTI_CODES) {
      const entry = TBTI_NAMES[code];
      expect(entry.code).toBe(code);
      for (const locale of [entry.ko, entry.en] as const) {
        for (const key of ['lead', 'title', 'nickname', 'breed'] as const) {
          expect(typeof locale[key]).toBe('string');
        }
        for (
          const key of [
            'definition',
            'strength',
            'slip',
            'empathy',
            'ensemble',
            'representativeGame',
            'closing',
          ] as const
        ) {
          expect(typeof locale.body[key]).toBe('string');
        }
      }
      // 카드 본문 영어판은 범위 밖 — en 본문 자리는 비워 둠
      expect(Object.values(entry.en.body).every((v) => v === '')).toBe(true);
    }
    // 예시값 자리 — 계약 R15-8 표 값 그대로
    expect(TBTI_NAMES['INOC']?.ko.title).toBe('얼리어답터 개척자');
    expect(TBTI_NAMES['RHAL']?.ko.breed).toBe('퍼그');
  });
});

describe('readAccountCreatedAt 포트', () => {
  it('account id=1 createdAt을 읽는다', () => {
    const { dir, db } = freshDb();
    try {
      db.prepare('INSERT INTO account (id, steam_id, created_at) VALUES (1, ?, ?)').run(
        '12345678901234567',
        1700000000,
      );
      expect(readAccountCreatedAt(db)).toBe(1700000000);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('행 없음은 null(미확인)을 낸다', () => {
    const { dir, db } = freshDb();
    try {
      expect(readAccountCreatedAt(db)).toBeNull();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('실제 읽기 오류(스키마 없음)는 throw한다', () => {
    const db = new Database(':memory:');
    try {
      expect(() => readAccountCreatedAt(db)).toThrow();
    } finally {
      db.close();
    }
  });
});

describe('series-aliases 로더', () => {
  it('파일 없음 → 내장 기본값 + missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'questail-r15alias-'));
    try {
      const result = loadSeriesAliases(dir);
      expect(result.status).toBe('missing');
      expect(result.aliases).toEqual(BUILTIN_SERIES_ALIASES);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('정상 파일 → 파일 값 + ok', () => {
    const dir = mkdtempSync(join(tmpdir(), 'questail-r15alias-'));
    try {
      writeFileSync(
        join(dir, 'series-aliases.json'),
        JSON.stringify({ aliases: { foo: 'bar' } }),
      );
      const result = loadSeriesAliases(dir);
      expect(result.status).toBe('ok');
      expect(result.aliases).toEqual({ foo: 'bar' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('깨진 파일 → 별칭 없이(null) + broken', () => {
    const dir = mkdtempSync(join(tmpdir(), 'questail-r15alias-'));
    try {
      writeFileSync(join(dir, 'series-aliases.json'), '{ broken json');
      const broken = loadSeriesAliases(dir);
      expect(broken.status).toBe('broken');
      expect(broken.aliases).toBeNull();
      writeFileSync(join(dir, 'series-aliases.json'), JSON.stringify({ aliases: { a: 1 } }));
      const wrongShape = loadSeriesAliases(dir);
      expect(wrongShape.status).toBe('broken');
      expect(wrongShape.aliases).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('읽기 오류(ENOENT 외) → 별칭 없이(null) + broken', () => {
    const dir = mkdtempSync(join(tmpdir(), 'questail-r15alias-'));
    try {
      // 같은 자리에 디렉터리를 두면 readFileSync가 EISDIR로 실패한다(읽기 오류 대표).
      mkdirSync(join(dir, 'series-aliases.json'));
      const result = loadSeriesAliases(dir);
      expect(result.status).toBe('broken');
      expect(result.aliases).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
