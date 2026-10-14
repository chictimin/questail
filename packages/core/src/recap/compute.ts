/**
 * R1.5 리캡 01~06 집계 (계약 R15-3·R15-4·R15-5 기간 연산, 동결 v1.0 + v1.0.1 델타).
 * 순수 함수 — DB·FS·HTTP·Date.now·Math.random·apps/web import 0.
 * 입력 RecapInput.games는 hidden 포함 원본 — 내부에서 hidden 제외 후 집계한다(R15-2 ①).
 */
import type { GameKey } from '../types.js';
import type { GameFacts } from '../archive/types.js';
import type {
  Caveat,
  LibraryRecap,
  Recap01,
  Recap02,
  Recap03,
  Recap04,
  Recap05,
  Recap06,
  RecapInput,
  TbtiCardSummary,
} from './types.js';

/** R15-10 「top5 동점 규칙」(확정 N6): 상위 5행 + 5위 동점 전원 포함 · 동률 key 오름차순. */
export const RECAP_TOP5_COUNT = 5;
/** R15-10 「03 구간 5개 경계」(확정): 하한 포함·상한 미포함, 분 단위(<2h·2~10h·10~30h·30~100h·100h+). */
export const RECAP_BUCKET_BOUNDS_MINUTES = [120, 600, 1800, 6000] as const;
/** R15-10 「별점 편차 경계」(확정): |dev| ≥ 1.0점(출력 0.5~5 척도). */
export const RECAP_RATING_DEV_THRESHOLD = 1.0;
/** R15-10 「편차작 행 수」(확정): high/low 각 3행(3 미만이면 있는 만큼). */
export const RECAP_DEVIANT_ROWS = 3;
/** R15-10 「출시 시기 구간」(제안): 신작=당해 · 최근=1~7년 전 · 고전=8년+. */
export const RECAP_RECENT_SPAN_YEARS = 7;
/** R15-5 「기간 연산」(확정): 1년 = 365일, 일 단위 epoch 비교(초 단위). */
export const RECAP_YEAR_SECONDS = 365 * 86400;
/** R15-3 s04 척도(확정): 출력 0.5~5 = 저장 1~10 ÷ 2 (apps/web 저장 코드 읽기전용 확인: ratings.ts ScoreValue 1~10 · format.ts starsOf score/2). */
export const RECAP_SCORE_DIVISOR = 2;
/** R15-3 s04 dist10(R17 제안): dist10[i] = 0.5×(i+1)점 게임 수, 0.5~5 오름차순 10칸. */
export const RECAP_DIST10_SIZE = 10;
/** R15-3 s02(제안, R17): 상위 8줄 + 미확인 줄(unknown=0이면 생략). 정렬 games 내림차순·동률 genreId 오름차순. */
export const RECAP_GENRE_BARS_MAX = 8;
/** R15-3 s02(제안): 미확인 줄 genreId. */
export const RECAP_GENRE_UNKNOWN_ID = '__unknown';

/** computeRecapSections 출력 묶음 — assembleLibraryRecap 입력. */
export interface RecapSections {
  basis: LibraryRecap['basis'];
  s01: Recap01;
  s02: Recap02;
  s03: Recap03;
  s04: Recap04;
  s05: Recap05;
  s06: Recap06;
}

/** 결정적 키 순서 — platform → externalId 바이트 비교(localeCompare 금지). */
function compareGameKey(a: GameKey, b: GameKey): number {
  if (a.platform !== b.platform) return a.platform < b.platform ? -1 : 1;
  if (a.externalId !== b.externalId) return a.externalId < b.externalId ? -1 : 1;
  return 0;
}

/** 현 보유 = 열린 보유 구간(ended=false) 있음 (PRD D26·R1 listLibrary includeEnded 대비). */
function isOwned(game: GameFacts): boolean {
  return game.ownership.some((span) => !span.ended);
}

/** R15-4 공통 caveats — 전 섹션 동일 순서·동일 hidden_excluded 값. */
function commonCaveats(hiddenExcluded: number, observedDays: number): Caveat[] {
  return [
    { code: 'observation_days', count: observedDays },
    { code: 'hidden_excluded', count: hiddenExcluded },
    { code: 'outside_steam_missing', count: null },
    { code: 'server_record_basis', count: null },
  ];
}

function epochToUtcYear(epochSeconds: number): number {
  return new Date(epochSeconds * 1000).getUTCFullYear();
}

function computeBasis(
  visible: GameFacts[],
  ownedObservedDays: string[],
): LibraryRecap['basis'] {
  const distinctDays = [...new Set(ownedObservedDays)].sort();
  const observedDays = distinctDays.length;
  let firstObservedAt: number | null = null;
  for (const game of visible) {
    const first = game.coverage.firstObservedAt;
    if (first !== null && (firstObservedAt === null || first < firstObservedAt)) {
      firstObservedAt = first;
    }
  }
  return {
    observedDays,
    rangeStart: observedDays > 0 ? distinctDays[0] : null,
    rangeEnd: observedDays > 0 ? distinctDays[distinctDays.length - 1] : null,
    firstObservedAt,
  };
}

function computeS01(visible: GameFacts[], base: Caveat[]): Recap01 {
  const totalMinutes = visible.reduce((sum, game) => sum + game.confirmedMinutes, 0);
  // F-22: 0분 게임 제외 후 정렬·동점 규칙 적용(제외 후 5위 동점 전원 포함).
  const sorted = [...visible]
    .filter((game) => game.confirmedMinutes > 0)
    .sort(
      (a, b) => b.confirmedMinutes - a.confirmedMinutes || compareGameKey(a.key, b.key),
    );
  let top = sorted.slice(0, RECAP_TOP5_COUNT);
  if (sorted.length > RECAP_TOP5_COUNT) {
    const cutoff = top[top.length - 1].confirmedMinutes;
    top = sorted.filter(
      (game, index) => index < RECAP_TOP5_COUNT || game.confirmedMinutes === cutoff,
    );
  }
  return {
    caveats: base,
    totalMinutes,
    top5: top.map((game) => ({
      key: game.key,
      minutes: game.confirmedMinutes,
      share: totalMinutes > 0 ? game.confirmedMinutes / totalMinutes : 0,
    })),
  };
}

function computeS02(visible: GameFacts[], base: Caveat[]): Recap02 {
  const counts = new Map<string, number>();
  let knownGames = 0;
  let unknownGames = 0;
  for (const game of visible) {
    if (game.genres.length === 0) {
      unknownGames += 1;
      continue;
    }
    knownGames += 1;
    for (const genreId of new Set(game.genres.map((genre) => genre.genreId))) {
      counts.set(genreId, (counts.get(genreId) ?? 0) + 1);
    }
  }
  const bars = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, RECAP_GENRE_BARS_MAX)
    .map(([genreId, games]) => ({ genreId, games }));
  if (unknownGames > 0) {
    bars.push({ genreId: RECAP_GENRE_UNKNOWN_ID, games: unknownGames });
  }
  return {
    caveats: [
      ...base,
      { code: 'genre_unknown', count: unknownGames },
      { code: 'genre_multi_overlap', count: null },
    ],
    knownGames,
    bars,
  };
}

/** 시점 미상 = 종료 시점 미상(ended + endedAt NULL) 또는 가져오기(origin imported) 구간 있음. */
function hasUnknownTimepoint(game: GameFacts): boolean {
  return game.ownership.some(
    (span) => (span.ended && span.endedAt === null) || span.origin === 'imported',
  );
}

function computeS03(visible: GameFacts[], base: Caveat[]): Recap03 {
  const ownedGames = visible.filter(isOwned);
  const playedMinutes = ownedGames
    .filter((game) => game.confirmedMinutes > 0)
    .map((game) => game.confirmedMinutes);
  const [b2h, b10h, b30h, b100h] = RECAP_BUCKET_BOUNDS_MINUTES;
  const buckets: Recap03['buckets'] = [
    { code: 'lt2h', games: 0 },
    { code: 'h2_10', games: 0 },
    { code: 'h10_30', games: 0 },
    { code: 'h30_100', games: 0 },
    { code: 'gte100h', games: 0 },
  ];
  for (const minutes of playedMinutes) {
    if (minutes < b2h) buckets[0].games += 1;
    else if (minutes < b10h) buckets[1].games += 1;
    else if (minutes < b30h) buckets[2].games += 1;
    else if (minutes < b100h) buckets[3].games += 1;
    else buckets[4].games += 1;
  }
  const unplayedKeys = ownedGames
    .filter((game) => game.confirmedMinutes <= 0)
    .map((game) => game.key)
    .sort(compareGameKey);
  const missing = visible.filter((game) => !isOwned(game));
  const missingKeys = missing.map((game) => game.key).sort(compareGameKey);
  const timepointUnknown = missing.filter(hasUnknownTimepoint).length;
  // medianMinutes: played 게임 confirmedMinutes 중앙값(분). played=0이면 null.
  // 짝수 개면 두 중앙값 평균(제안).
  const sortedMinutes = [...playedMinutes].sort((a, b) => a - b);
  let medianMinutes: number | null = null;
  if (sortedMinutes.length > 0) {
    const mid = Math.floor(sortedMinutes.length / 2);
    medianMinutes =
      sortedMinutes.length % 2 === 1
        ? sortedMinutes[mid]
        : (sortedMinutes[mid - 1] + sortedMinutes[mid]) / 2;
  }
  return {
    caveats: [...base, { code: 'timepoint_unknown', count: timepointUnknown }],
    owned: ownedGames.length,
    played: playedMinutes.length,
    medianMinutes,
    buckets,
    unplayedKeys,
    missingKeys,
  };
}

function computeS04(visible: GameFacts[], base: Caveat[]): Recap04 {
  const rated = ownedGamesOf(visible).filter((game) => game.latestScore !== null);
  const ratedCount = rated.length;
  const scores = rated.map((game) => ({
    key: game.key,
    score: (game.latestScore as number) / RECAP_SCORE_DIVISOR,
  }));
  const mean = ratedCount > 0 ? scores.reduce((sum, row) => sum + row.score, 0) / ratedCount : null;
  const dist10 = new Array<number>(RECAP_DIST10_SIZE).fill(0);
  for (const game of rated) {
    const index = (game.latestScore as number) - 1;
    if (index >= 0 && index < RECAP_DIST10_SIZE) dist10[index] += 1;
  }
  const withDev = scores.map((row) => ({ ...row, dev: mean === null ? 0 : row.score - mean }));
  const byAbsDev = (a: { dev: number; key: GameKey }, b: { dev: number; key: GameKey }) =>
    Math.abs(b.dev) - Math.abs(a.dev) || compareGameKey(a.key, b.key);
  const high = withDev
    .filter((row) => row.dev >= RECAP_RATING_DEV_THRESHOLD)
    .sort(byAbsDev)
    .slice(0, RECAP_DEVIANT_ROWS)
    .map((row) => ({ key: row.key, score: row.score, dev: row.dev }));
  const low = withDev
    .filter((row) => row.dev <= -RECAP_RATING_DEV_THRESHOLD)
    .sort(byAbsDev)
    .slice(0, RECAP_DEVIANT_ROWS)
    .map((row) => ({ key: row.key, score: row.score, dev: row.dev }));
  return {
    caveats: [...base, { code: 'rated_only', count: ratedCount }],
    ratedCount,
    mean,
    dist10,
    high,
    low,
  };
}

function ownedGamesOf(visible: GameFacts[]): GameFacts[] {
  return visible.filter(isOwned);
}

function computeS05(
  visible: GameFacts[],
  now: number,
  base: Caveat[],
): Recap05 {
  const year = epochToUtcYear(now);
  const bands: Recap05['bands'] = [
    { code: 'new', fromYear: year, toYear: year, games: 0 },
    { code: 'recent', fromYear: year - RECAP_RECENT_SPAN_YEARS, toYear: year - 1, games: 0 },
    { code: 'classic', fromYear: null, toYear: year - RECAP_RECENT_SPAN_YEARS - 1, games: 0 },
  ];
  let releaseUnknown = 0;
  for (const game of visible) {
    if (game.releaseDate === null) {
      releaseUnknown += 1;
      continue;
    }
    const releaseYear = epochToUtcYear(game.releaseDate);
    if (releaseYear >= year) bands[0].games += 1;
    else if (releaseYear >= year - RECAP_RECENT_SPAN_YEARS) bands[1].games += 1;
    else bands[2].games += 1;
  }
  return {
    caveats: [...base, { code: 'release_unknown', count: releaseUnknown }],
    bands,
  };
}

function computeS06(
  visible: GameFacts[],
  now: number,
  accountCreatedAt: number | null,
  base: Caveat[],
): Recap06 {
  const perYear = new Map<number, number>();
  let releaseUnknown = 0;
  for (const game of visible) {
    if (game.releaseDate === null) {
      releaseUnknown += 1;
      continue;
    }
    const releaseYear = epochToUtcYear(game.releaseDate);
    perYear.set(releaseYear, (perYear.get(releaseYear) ?? 0) + 1);
  }
  const sortedYears = [...perYear.keys()].sort((a, b) => a - b);
  const years: Recap06['years'] =
    sortedYears.length === 0
      ? []
      : Array.from(
          { length: sortedYears[sortedYears.length - 1] - sortedYears[0] + 1 },
          (_, offset) => {
            const year = sortedYears[0] + offset;
            return { year, games: perYear.get(year) ?? 0 };
          },
        );
  const comparePrevYear =
    accountCreatedAt === null ? false : now >= accountCreatedAt + RECAP_YEAR_SECONDS;
  return {
    caveats: [
      ...base,
      { code: 'release_unknown', count: releaseUnknown },
      { code: 'release_not_purchase', count: null },
    ],
    years,
    comparePrevYear,
  };
}

/**
 * 리캡 01~06 집계 본체 (계약 R15-3·R15-4·기간 연산).
 * hidden 제외 + 제외 수를 hidden_excluded caveat에 전 섹션 동일값으로 싣는다(R15-2 ①).
 */
export function computeRecapSections(input: RecapInput): RecapSections {
  const hiddenExcluded = input.games.filter((game) => game.hidden).length;
  const visible = input.games.filter((game) => !game.hidden);
  const basis = computeBasis(visible, input.ownedObservedDays);
  const base = commonCaveats(hiddenExcluded, basis.observedDays);
  return {
    basis,
    s01: computeS01(visible, base),
    s02: computeS02(visible, base),
    s03: computeS03(visible, base),
    s04: computeS04(visible, base),
    s05: computeS05(visible, input.now, base),
    s06: computeS06(visible, input.now, input.accountCreatedAt, base),
  };
}

/** LibraryRecap 조립 — 섹션 묶음 + TBTI 요약 카드. */
export function assembleLibraryRecap(
  sections: RecapSections,
  summary: TbtiCardSummary,
): LibraryRecap {
  return {
    basis: sections.basis,
    s01: sections.s01,
    s02: sections.s02,
    s03: sections.s03,
    s04: sections.s04,
    s05: sections.s05,
    s06: sections.s06,
    tbti: summary,
  };
}
