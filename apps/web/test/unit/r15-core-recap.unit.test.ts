import { describe, expect, it } from 'vitest';
import {
  assembleLibraryRecap,
  computeRecapSections,
  toCardSummary,
} from '@questail/core';
import type { GameFacts, RecapInput, TbtiResult } from '@questail/core';

/**
 * T1 리캡 01~06 집계 테스트. 합성 픽스처만 쓴다. 실 Steam·실키 호출 없음.
 * 계약 .roster/contract-r15-v1.0.md R15-3·R15-4·R15-5 기간 연산 기준.
 */
const NOW = Math.floor(Date.UTC(2026, 9, 13, 0, 0, 0) / 1000);
const DAY = 86400;
const dayOf = (year: number): number => Math.floor(Date.UTC(year, 0, 1) / 1000);

function openSpan(startedAt: number | null = NOW - 30 * DAY): GameFacts['ownership'] {
  return [
    { origin: 'observed', startedAt, ended: false, endedAt: null, isBaseline: false, syncRunId: null },
  ];
}

function endedSpan(endedAt: number | null): GameFacts['ownership'] {
  return [
    { origin: 'observed', startedAt: NOW - 300 * DAY, ended: true, endedAt, isBaseline: false, syncRunId: null },
  ];
}

function genreOf(genreId: string): GameFacts['genres'][number] {
  return { genreId, nameEn: genreId, nameKo: null };
}

function makeFacts(over: Partial<GameFacts> & { key: GameFacts['key'] }): GameFacts {
  return {
    name: null,
    titleKo: null,
    developerRaw: null,
    releaseDate: null,
    releaseDateText: null,
    genres: [],
    coverUrl: null,
    hidden: false,
    libraryAddedAt: null,
    confirmedMinutes: 0,
    lastPlayed: null,
    snapshots: [],
    deltas: [],
    coverage: { firstObservedAt: null, lastObservedAt: null, gapDays: [], isBaseline: false },
    ownership: openSpan(),
    wishlist: [],
    tags: [],
    tagStatus: 'not_collected',
    achievements: [],
    achievementState: 'not_collected',
    achievementSummary: null,
    latestScore: null,
    ratingEvents: [],
    syncRunRefs: [],
    ...over,
  };
}

const keyOf = (id: string): GameFacts['key'] => ({ platform: 'steam', externalId: id });

function pendingTbti(): TbtiResult {
  const axis = (n: 1 | 2 | 3 | 4): TbtiResult['axes'][number] => ({
    axis: n,
    primary: '?',
    primaryPct: null,
    secondary: null,
    secondaryPct: null,
    nInterval: null,
    chips: [],
    evidence: [],
    excludedCount: 0,
    held: true,
    heldReasonKey: 'short_sample',
    metrics: null,
    caveats: [],
    baselineKey: null,
    baselineTextKey: null,
  });
  return { code: '????', axes: [axis(1), axis(2), axis(3), axis(4)], pending: true, pendingHours: { have: 0, need: 300 }, caveats: [], gameLetters: [], aliasStatus: 'missing' };
}

/** 메인 픽스처: 동점·경계·숨김·빠짐·미평점·미확인 장르/출시일을 한 번에 둔다. */
function mainGames(): GameFacts[] {
  return [
    makeFacts({ key: keyOf('01'), confirmedMinutes: 6000, genres: [genreOf('Action'), genreOf('RPG')], releaseDate: dayOf(2026), latestScore: 10, coverage: { firstObservedAt: 1000, lastObservedAt: 2000, gapDays: [], isBaseline: false } }),
    makeFacts({ key: keyOf('02'), confirmedMinutes: 6000, genres: [genreOf('Action')], releaseDate: dayOf(2025), latestScore: 2, coverage: { firstObservedAt: 2000, lastObservedAt: 3000, gapDays: [], isBaseline: false } }),
    makeFacts({ key: keyOf('03'), confirmedMinutes: 3000, genres: [], releaseDate: dayOf(2018), latestScore: 8 }),
    makeFacts({ key: keyOf('04'), confirmedMinutes: 3000, genres: [genreOf('RPG')], releaseDate: dayOf(2019), latestScore: 6 }),
    makeFacts({ key: keyOf('05'), confirmedMinutes: 100, genres: [genreOf('Action')], releaseDate: null }),
    makeFacts({ key: keyOf('06'), confirmedMinutes: 0, genres: [genreOf('Puzzle')], releaseDate: dayOf(2010), latestScore: 4 }),
    makeFacts({ key: keyOf('07'), confirmedMinutes: 500, genres: [genreOf('Action')], releaseDate: dayOf(2020), latestScore: 8, ownership: endedSpan(null) }),
    makeFacts({ key: keyOf('08'), confirmedMinutes: 99999, genres: [genreOf('Action')], releaseDate: dayOf(2026), latestScore: 10, hidden: true }),
    makeFacts({ key: keyOf('09'), confirmedMinutes: 119, genres: [genreOf('Puzzle')], releaseDate: dayOf(2026) }),
    makeFacts({ key: keyOf('10'), confirmedMinutes: 120, genres: [genreOf('Puzzle')], releaseDate: dayOf(2026) }),
    makeFacts({ key: keyOf('11'), confirmedMinutes: 500, genres: [genreOf('Sim')], releaseDate: dayOf(2021) }),
  ];
}

function mainInput(over: Partial<RecapInput> = {}): RecapInput {
  return {
    games: mainGames(),
    accountCreatedAt: NOW - 400 * DAY,
    now: NOW,
    ownedObservedDays: ['2026-10-01', '2026-10-02', '2026-10-01'],
    tbti: pendingTbti(),
    ...over,
  };
}

describe('r15-core-recap', () => {
  it('basis: observedDays distinct 수 · firstObservedAt 최소값 · rangeStart~End', () => {
    const sections = computeRecapSections(mainInput());
    expect(sections.basis).toEqual({ observedDays: 2, rangeStart: '2026-10-01', rangeEnd: '2026-10-02', firstObservedAt: 1000 });
  });

  it('관측 0건이면 observedDays 0 · range null · firstObservedAt null', () => {
    const sections = computeRecapSections(mainInput({ games: [], ownedObservedDays: [] }));
    expect(sections.basis).toEqual({ observedDays: 0, rangeStart: null, rangeEnd: null, firstObservedAt: null });
  });

  it('s01: 숨김 제외 합 분모 · 동률 key 오름차순 · 5위 동점 전원 포함', () => {
    const sections = computeRecapSections(mainInput());
    const total = 6000 + 6000 + 3000 + 3000 + 100 + 0 + 500 + 119 + 120 + 500;
    expect(sections.s01.totalMinutes).toBe(total);
    expect(sections.s01.top5.map((row) => row.key.externalId)).toEqual(['01', '02', '03', '04', '07', '11']);
    expect(sections.s01.top5.map((row) => row.minutes)).toEqual([6000, 6000, 3000, 3000, 500, 500]);
    for (const row of sections.s01.top5) {
      expect(row.share).toBeCloseTo(row.minutes / total, 12);
    }
  });

  it('s01(F-22): 0분 게임 제외 — top5에 0분 행 없음', () => {
    const sections = computeRecapSections(mainInput());
    for (const row of sections.s01.top5) {
      expect(row.minutes).toBeGreaterThan(0);
    }
  });

  it('s01(F-22): 전부 0분이면 top5 빈 배열 · totalMinutes 0', () => {
    const games = mainGames().map((game) => ({ ...game, confirmedMinutes: 0 }));
    const sections = computeRecapSections(mainInput({ games }));
    expect(sections.s01.totalMinutes).toBe(0);
    expect(sections.s01.top5).toEqual([]);
  });

  it('s02: 상위 줄 + __unknown 줄 · knownGames', () => {
    const sections = computeRecapSections(mainInput());
    expect(sections.s02.knownGames).toBe(9);
    expect(sections.s02.bars).toEqual([
      { genreId: 'Action', games: 4 },
      { genreId: 'Puzzle', games: 3 },
      { genreId: 'RPG', games: 2 },
      { genreId: 'Sim', games: 1 },
      { genreId: '__unknown', games: 1 },
    ]);
  });

  it('s02: unknown=0이면 미확인 줄 생략', () => {
    const games = mainGames().map((game) =>
      game.genres.length === 0 ? { ...game, genres: [genreOf('Sim')] } : game,
    );
    const sections = computeRecapSections(mainInput({ games }));
    expect(sections.s02.bars.some((bar) => bar.genreId === '__unknown')).toBe(false);
    expect(sections.s02.knownGames).toBe(10);
  });

  it('s03: owned·played·5구간(하한 포함) · unplayed · missing · timepoint_unknown', () => {
    const sections = computeRecapSections(mainInput());
    expect(sections.s03.owned).toBe(9);
    expect(sections.s03.played).toBe(8);
    expect(sections.s03.buckets).toEqual([
      { code: 'lt2h', games: 2 },
      { code: 'h2_10', games: 2 },
      { code: 'h10_30', games: 0 },
      { code: 'h30_100', games: 2 },
      { code: 'gte100h', games: 2 },
    ]);
    expect(sections.s03.unplayedKeys).toEqual([keyOf('06')]);
    expect(sections.s03.missingKeys).toEqual([keyOf('07')]);
    expect(sections.s03.medianMinutes).toBe(1750);
    expect(sections.s03.caveats).toContainEqual({ code: 'timepoint_unknown', count: 1 });
  });

  it('s03 medianMinutes: 홀수 개면 중앙값 · played=0이면 null', () => {
    const one = [makeFacts({ key: keyOf('a'), confirmedMinutes: 100 })];
    expect(computeRecapSections(mainInput({ games: one })).s03.medianMinutes).toBe(100);
    const three = [
      ...one,
      makeFacts({ key: keyOf('b'), confirmedMinutes: 300 }),
      makeFacts({ key: keyOf('c'), confirmedMinutes: 200 }),
    ];
    expect(computeRecapSections(mainInput({ games: three })).s03.medianMinutes).toBe(200);
    const zeroOnly = [makeFacts({ key: keyOf('z'), confirmedMinutes: 0 })];
    expect(computeRecapSections(mainInput({ games: zeroOnly })).s03.medianMinutes).toBeNull();
  });

  it('s03 medianMinutes: 짝수 개면 두 중앙값 평균', () => {
    const two = [
      makeFacts({ key: keyOf('a'), confirmedMinutes: 100 }),
      makeFacts({ key: keyOf('b'), confirmedMinutes: 200 }),
    ];
    expect(computeRecapSections(mainInput({ games: two })).s03.medianMinutes).toBe(150);
  });

  it('s04: 출력 척도 0.5~5 · mean 매긴 게임만 · dist10 · high/low', () => {
    const sections = computeRecapSections(mainInput());
    expect(sections.s04.ratedCount).toBe(5);
    expect(sections.s04.mean).toBeCloseTo(3, 12);
    expect(sections.s04.dist10).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
    expect(sections.s04.high.map((row) => row.key.externalId)).toEqual(['01', '03']);
    expect(sections.s04.low.map((row) => row.key.externalId)).toEqual(['02', '06']);
    expect(sections.s04.high[0]).toMatchObject({ score: 5, dev: 2 });
    expect(sections.s04.low[0]).toMatchObject({ score: 1, dev: -2 });
    expect(sections.s04.caveats).toContainEqual({ code: 'rated_only', count: 5 });
  });

  it('s04: 별점 0개면 mean null · 분포 0', () => {
    const games = mainGames().map((game) => ({ ...game, latestScore: null }));
    const sections = computeRecapSections(mainInput({ games }));
    expect(sections.s04.ratedCount).toBe(0);
    expect(sections.s04.mean).toBeNull();
    expect(sections.s04.dist10).toEqual(new Array(10).fill(0));
    expect(sections.s04.high).toEqual([]);
    expect(sections.s04.low).toEqual([]);
  });

  it('s05: new·recent·classic 환산 · classic fromYear null', () => {
    const sections = computeRecapSections(mainInput());
    expect(sections.s05.bands).toEqual([
      { code: 'new', fromYear: 2026, toYear: 2026, games: 3 },
      { code: 'recent', fromYear: 2019, toYear: 2025, games: 4 },
      { code: 'classic', fromYear: null, toYear: 2018, games: 2 },
    ]);
    expect(sections.s05.caveats).toContainEqual({ code: 'release_unknown', count: 1 });
  });

  it('s06: min~max 오름차순 연도 · comparePrevYear', () => {
    const sections = computeRecapSections(mainInput());
    expect(sections.s06.years[0]).toEqual({ year: 2010, games: 1 });
    expect(sections.s06.years[sections.s06.years.length - 1]).toEqual({ year: 2026, games: 3 });
    expect(sections.s06.years).toHaveLength(17);
    expect(sections.s06.years.find((row) => row.year === 2015)).toEqual({ year: 2015, games: 0 });
    expect(sections.s06.comparePrevYear).toBe(true);
    expect(computeRecapSections(mainInput({ accountCreatedAt: null })).s06.comparePrevYear).toBe(false);
    expect(computeRecapSections(mainInput({ accountCreatedAt: NOW - 100 * DAY })).s06.comparePrevYear).toBe(false);
  });

  it('caveats: hidden_excluded 전 섹션 동일값 · 공통 4종', () => {
    const sections = computeRecapSections(mainInput());
    for (const section of [sections.s01, sections.s02, sections.s03, sections.s04, sections.s05, sections.s06]) {
      expect(section.caveats.slice(0, 4)).toEqual([
        { code: 'observation_days', count: 2 },
        { code: 'hidden_excluded', count: 1 },
        { code: 'outside_steam_missing', count: null },
        { code: 'server_record_basis', count: null },
      ]);
    }
  });

  it('빈 입력이면 틀 유지 · 0/빈 값', () => {
    const sections = computeRecapSections(mainInput({ games: [], ownedObservedDays: [], accountCreatedAt: null }));
    expect(sections.s01.totalMinutes).toBe(0);
    expect(sections.s01.top5).toEqual([]);
    expect(sections.s02).toMatchObject({ knownGames: 0, bars: [] });
    expect(sections.s03).toMatchObject({ owned: 0, played: 0, medianMinutes: null, unplayedKeys: [], missingKeys: [] });
    expect(sections.s04.mean).toBeNull();
    expect(sections.s05.bands.map((band) => band.games)).toEqual([0, 0, 0]);
    expect(sections.s06.years).toEqual([]);
  });

  it('같은 입력은 같은 출력이다', () => {
    expect(computeRecapSections(mainInput())).toEqual(computeRecapSections(mainInput()));
  });

  it('toCardSummary: pending이면 ????·? 4개·mini null', () => {
    expect(toCardSummary(pendingTbti())).toEqual({
      code: '????',
      pending: true,
      letters: ['?', '?', '?', '?'],
      mini: [
        { axis: 1, pct: null },
        { axis: 2, pct: null },
        { axis: 3, pct: null },
        { axis: 4, pct: null },
      ],
    });
  });

  it('toCardSummary: 비보류면 letters 순서 · mini ①③④ primaryPct · ② nInterval.min', () => {
    const result: TbtiResult = {
      code: 'INOC',
      pending: false,
      pendingHours: null,
      caveats: [],
      gameLetters: [],
      aliasStatus: 'missing',
      axes: [
        { axis: 1, primary: 'I', primaryPct: 60, secondary: 'R', secondaryPct: 40, nInterval: null, chips: [], evidence: [], excludedCount: 0, held: false, heldReasonKey: null, metrics: null, caveats: [], baselineKey: null, baselineTextKey: null },
        { axis: 2, primary: 'N', primaryPct: 42, secondary: 'H', secondaryPct: 30, nInterval: { min: 42, max: 65 }, chips: [], evidence: [], excludedCount: 0, held: false, heldReasonKey: null, metrics: null, caveats: [], baselineKey: null, baselineTextKey: null },
        { axis: 3, primary: 'O', primaryPct: 55, secondary: 'A', secondaryPct: 45, nInterval: null, chips: [], evidence: [], excludedCount: 0, held: false, heldReasonKey: null, metrics: null, caveats: [], baselineKey: null, baselineTextKey: null },
        { axis: 4, primary: 'C', primaryPct: 70, secondary: 'L', secondaryPct: 30, nInterval: null, chips: [], evidence: [], excludedCount: 0, held: false, heldReasonKey: null, metrics: null, caveats: [], baselineKey: null, baselineTextKey: null },
      ],
    };
    expect(toCardSummary(result)).toEqual({
      code: 'INOC',
      pending: false,
      letters: ['I', 'N', 'O', 'C'],
      mini: [
        { axis: 1, pct: 60 },
        { axis: 2, pct: 42 },
        { axis: 3, pct: 55 },
        { axis: 4, pct: 70 },
      ],
    });
  });

  it('toCardSummary: held ②축 mini는 null(F-15 interval_cross도 nInterval을 실으므로)', () => {
    const result: TbtiResult = {
      code: 'I?OC',
      pending: false,
      pendingHours: null,
      caveats: [],
      gameLetters: [],
      aliasStatus: 'missing',
      axes: [
        { axis: 1, primary: 'I', primaryPct: 60, secondary: 'R', secondaryPct: 40, nInterval: null, chips: [], evidence: [], excludedCount: 0, held: false, heldReasonKey: null, metrics: null, caveats: [], baselineKey: null, baselineTextKey: null },
        { axis: 2, primary: '?', primaryPct: null, secondary: 'H', secondaryPct: 30, nInterval: { min: 40, max: 60 }, chips: [], evidence: [], excludedCount: 0, held: true, heldReasonKey: 'interval_cross', metrics: null, caveats: [], baselineKey: null, baselineTextKey: null },
        { axis: 3, primary: 'O', primaryPct: 55, secondary: 'A', secondaryPct: 45, nInterval: null, chips: [], evidence: [], excludedCount: 0, held: false, heldReasonKey: null, metrics: null, caveats: [], baselineKey: null, baselineTextKey: null },
        { axis: 4, primary: 'C', primaryPct: 70, secondary: 'L', secondaryPct: 30, nInterval: null, chips: [], evidence: [], excludedCount: 0, held: false, heldReasonKey: null, metrics: null, caveats: [], baselineKey: null, baselineTextKey: null },
      ],
    };
    expect(toCardSummary(result)).toEqual({
      code: 'I?OC',
      pending: false,
      letters: ['I', '?', 'O', 'C'],
      mini: [
        { axis: 1, pct: 60 },
        { axis: 2, pct: null },
        { axis: 3, pct: 55 },
        { axis: 4, pct: 70 },
      ],
    });
  });

  it('assembleLibraryRecap: 섹션 + 요약 조립', () => {
    const sections = computeRecapSections(mainInput());
    const recap = assembleLibraryRecap(sections, toCardSummary(pendingTbti()));
    expect(recap.basis).toEqual(sections.basis);
    expect(recap.s01).toEqual(sections.s01);
    expect(recap.s06).toEqual(sections.s06);
    expect(recap.tbti.code).toBe('????');
  });
});
