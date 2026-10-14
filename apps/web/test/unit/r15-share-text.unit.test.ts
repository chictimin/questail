import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LibraryRecap, TbtiResult } from '@questail/core';
import {
  RECAP_EXPORT_FILENAME,
  renderRecapExportFile,
  renderRecapText,
} from '../../src/data/recapText.js';
import { renderTbtiShare } from '../../src/data/tbtiShare.js';
import { readTbti } from '../../src/data/tbti.js';

/**
 * S3 텍스트 렌더 픽스처 대조 — A-8(recap) · 10a(TBTI 공유) 형식 그대로.
 * 숫자는 고정 픽스처 실값이라 출력이 한 글자라도 바뀌면 깨진다.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 빈 스키마 DB — 실판정이 보류(????)를 내는 입력이다. */
function freshEmptyDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-r15share-'));
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
const NAMES = new Map([
  ['steam/1', 'Monster Hunter Wilds'],
  ['steam/2', 'Stardew Valley'],
]);

/** 장르표 — 이름 쌍. 표시 선택은 공용 genreDisplayNames 몫이다. */
const GENRES = new Map([
  ['action', { nameKo: '액션', nameEn: 'Action' }],
  ['adventure', { nameKo: '어드벤처', nameEn: 'Adventure' }],
  ['indie', { nameKo: '인디', nameEn: 'Indie' }],
]);
/** nameEn 없음 — en에서 한국어가 나오면 안 된다. */
const GENRES_KO_ONLY = new Map([
  ['action', { nameKo: '액션', nameEn: null }],
  ['adventure', { nameKo: '어드벤처', nameEn: null }],
  ['indie', { nameKo: '인디', nameEn: null }],
]);

const RECAP: LibraryRecap = {
  basis: { observedDays: 2, rangeStart: null, rangeEnd: null, firstObservedAt: 1700000000 },
  s01: {
    caveats: [],
    totalMinutes: 407760,
    top5: [
      { key: { platform: 'steam', externalId: '1' }, minutes: 55314, share: 0.1357 },
      { key: { platform: 'steam', externalId: '2' }, minutes: 19104, share: 0.0469 },
    ],
  },
  s02: {
    caveats: [],
    knownGames: 90,
    bars: [
      { genreId: 'action', games: 50 },
      { genreId: 'adventure', games: 40 },
      { genreId: 'indie', games: 30 },
    ],
  },
  s03: {
    caveats: [],
    owned: 123,
    played: 108,
    medianMinutes: null,
    buckets: [
      { code: 'lt2h', games: 0 },
      { code: 'h2_10', games: 0 },
      { code: 'h10_30', games: 0 },
      { code: 'h30_100', games: 0 },
      { code: 'gte100h', games: 0 },
    ],
    unplayedKeys: [],
    missingKeys: [],
  },
  s04: {
    caveats: [],
    ratedCount: 90,
    mean: 2.9,
    dist10: [10, 12, 8, 9, 11, 10, 9, 8, 7, 6],
    high: [],
    low: [],
  },
  s05: {
    caveats: [],
    bands: [
      { code: 'new', fromYear: 2026, toYear: 2026, games: 1 },
      { code: 'recent', fromYear: 2019, toYear: 2025, games: 2 },
      { code: 'classic', fromYear: null, toYear: 2018, games: 3 },
    ],
  },
  s06: { caveats: [], years: [], comparePrevYear: false },
  tbti: {
    code: 'INAC',
    pending: false,
    letters: ['I', 'N', 'A', 'C'],
    mini: [
      { axis: 1, pct: 83 },
      { axis: 2, pct: 55 },
      { axis: 3, pct: 85 },
      { axis: 4, pct: 78 },
    ],
  },
};

function axis(
  axisNum: 1 | 2 | 3 | 4,
  primary: 'I' | 'N' | 'A' | 'C',
  primaryPct: number,
  extra?: Partial<Parameters<typeof renderTbtiShare>[0]['axes'][number]>,
): TbtiResult['axes'][number] {
  return {
    axis: axisNum,
    primary,
    primaryPct,
    secondary: null,
    secondaryPct: null,
    nInterval: null,
    chips: [],
    evidence: [],
    excludedCount: 0,
    held: false,
    heldReasonKey: null,
    caveats: [],
    baselineKey: null,
    baselineTextKey: null,
    metrics: null,
    ...extra,
  };
}

const RESULT: TbtiResult = {
  code: 'INAC',
  axes: [
    axis(1, 'I', 83),
    axis(2, 'N', 60, {
      secondary: 'H',
      secondaryPct: 34,
      nInterval: { min: 55, max: 70 },
    }),
    axis(3, 'A', 85),
    axis(4, 'C', 78, { chips: ['ach_not_reflected'] }),
  ],
  pending: false,
  pendingHours: null,
  gameLetters: [],
  aliasStatus: 'missing',
  caveats: [
    { code: 'observation_days', count: 2 },
    { code: 'hidden_excluded', count: 0 },
    { code: 'outside_steam_missing', count: null },
    { code: 'server_record_basis', count: null },
  ],
};

describe('renderRecapText 픽스처 대조', () => {
  it('ko — A-8 형식 그대로', () => {
    const text = renderRecapText(RECAP, 'ko', NAMES, GENRES);
    expect(text).toBe(
      [
        'questail recap — 전체 라이브러리 (관측 2일분, 첫 수집 기준)',
        '- 누적 플레이타임: 6,796시간 (보유 123개 중 108개 플레이)',
        '- 상위 5: Monster Hunter Wilds 922h · Stardew Valley 318h',
        '- 장르: 액션 · 어드벤처 · 인디가 많음',
        '- 별점: 90개, 평균 ★3',
        '- TBTI: 끈질긴 대식가 (INAC)',
        '시간은 Steam 서버 기록 기준이에요.',
      ].join('\n'),
    );
    expect(text).not.toContain('action');
  });

  it('en — 코드·축 이름·UI만 영어, 한국어 0', () => {
    const text = renderRecapText(RECAP, 'en', NAMES, GENRES);
    expect(text).toBe(
      [
        'questail recap — full library (2 days observed, based on first collection)',
        '- Total playtime: 6,796 hours (played 108 of 123 owned)',
        '- Top 5: Monster Hunter Wilds 922h · Stardew Valley 318h',
        '- Top genres: Action · Adventure · Indie',
        '- Ratings: 90, average ★3',
        '- TBTI: INAC',
        'Times are based on Steam server records.',
      ].join('\n'),
    );
    expect(text).not.toMatch(/[가-힣]/);
  });

  it('en — nameEn 없는 장르는 줄에서 빠져 한국어가 나오지 않는다', () => {
    const text = renderRecapText(RECAP, 'en', NAMES, GENRES_KO_ONLY);
    expect(text).not.toMatch(/[가-힣]/);
    expect(text).not.toContain('- Top genres:');
    expect(text).not.toContain('action');
  });
});

describe('renderRecapExportFile', () => {
  it('frontmatter 영문 고정 + ko 본문 + recap.md', () => {
    const file = renderRecapExportFile(RECAP, 'ko', NAMES, GENRES);
    expect(file.filename).toBe(RECAP_EXPORT_FILENAME);
    expect(file.content).toBe(
      [
        '---',
        'kind: "recap"',
        'observed_days: 2',
        'total_minutes: 407760',
        'owned: 123',
        'played: 108',
        'rated_count: 90',
        'tbti_code: "INAC"',
        '---',
        '',
        'questail recap — 전체 라이브러리 (관측 2일분, 첫 수집 기준)',
        '- 누적 플레이타임: 6,796시간 (보유 123개 중 108개 플레이)',
        '- 상위 5: Monster Hunter Wilds 922h · Stardew Valley 318h',
        '- 장르: 액션 · 어드벤처 · 인디가 많음',
        '- 별점: 90개, 평균 ★3',
        '- TBTI: 끈질긴 대식가 (INAC)',
        '시간은 Steam 서버 기록 기준이에요.',
        '',
      ].join('\n'),
    );
  });
});

describe('renderTbtiShare 픽스처 대조', () => {
  it('ko — 10a 형식 그대로(정의 줄은 이름 데이터 실값)', () => {
    expect(renderTbtiShare(RESULT, 'ko')).toBe(
      [
        '내 TBTI는 INAC — 끈질긴 대식가',
        '몰입 83% · 신작 60%(본진 비중 34%) · 잡식 85% · 파먹기 78%',
        '파먹기 축은 플레이 시간만으로 정했어요.',
        '관측 2일분, 첫 수집 기준 · questail',
      ].join('\n'),
    );
  });

  it('en — PM #109421 구성, 한국어·별명 0', () => {
    const text = renderTbtiShare(RESULT, 'en');
    expect(text).toBe(
      [
        'My TBTI is INAC',
        'Immersion 83% · New 60% (Home 34%) · All-rounder 85% · Completionist 78%',
        'The Completionist axis reflects playtime only.',
        '2 days observed, based on first collection · questail',
      ].join('\n'),
    );
    expect(text).not.toMatch(/[가-힣]/);
    expect(text).not.toContain('Pilgrim');
  });

  it('pending 실판정 — 보류 안내 줄', () => {
    const { dir, db } = freshEmptyDb();
    try {
      expect(renderTbtiShare(readTbti(db, dir), 'ko')).toBe(
        [
          '내 TBTI는 ????',
          '아직 TBTI를 정하기엔 기록이 적어요. 총 5시간만 놀면 판정해 드릴게요.',
          '관측 0일분, 첫 수집 기준 · questail',
        ].join('\n'),
      );
      const en = renderTbtiShare(readTbti(db, dir), 'en');
      expect(en).toBe(
        [
          'My TBTI is ????',
          'Not enough play history yet — play 5 hours in total to get your TBTI.',
          '0 days observed, based on first collection · questail',
        ].join('\n'),
      );
      expect(en).not.toMatch(/[가-힣]/);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
