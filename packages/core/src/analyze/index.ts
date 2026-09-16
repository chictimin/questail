/**
 * 취향 분석 리포트 (Phase 3 W-anal).
 *
 * D3 — 정량 리포트가 먼저 서고, LLM 정성 해석을 그 위에 얹는다.
 * stats는 LLM 없이 순수 계산으로 항상 채워진다. summary는
 * canCallLlm(options)이 true일 때만 호출을 시도하고, 설정이 없거나
 * 호출이 실패하면 summary 없이(warnFallback 1줄 + 정량 리포트만) 반환한다.
 * 어떤 경우에도 전체를 throw하지 않는다.
 *
 * 시그니처 근거: library를 첫 번째 필수 인자로 받는다.
 * TasteProfile만으로는 총 게임 수·상위 타이틀·편중도를 계산할 수 없어서
 * LibraryIndex가 필수 입력이다 (호출 흐름상 호출자는 항상 둘 다 들고 있다).
 */

import type { LibraryIndex, LlmOptions, TasteProfile } from '../types.js';
import { callLlm, canCallLlm, warnFallback } from '../llm/index.js';

export interface AnalysisReport {
  /** LLM 정성 해석 — 무LLM 폴백 시 undefined (빈 문자열 아님) */
  summary?: string;
  /** 정량 지표 — LLM 유무와 무관하게 항상 채워짐 */
  stats: QuantitativeStats;
}

/** 플레이타임 상위 게임 1개 */
export interface TopGameStat {
  title: string;
  playtimeMinutes: number;
  playtimeHours: number;
  /** 총 플레이타임 대비 비중 (%) */
  sharePercent: number;
}

/** computeStats가 채우는 정량 지표 본체 (AnalysisReport.stats에 그대로 담긴다) */
export interface QuantitativeStats {
  gameCount: number;
  totalPlaytimeMinutes: number;
  totalPlaytimeHours: number;
  topGames: TopGameStat[];
  genreDistribution: { genre: string; weight: number; percent: number }[];
  /** 분 단위 5수 요약 (profile.playtimeDistribution 그대로) */
  playtimeDistribution: { min: number; q1: number; median: number; q3: number; max: number };
  /** 시간 단위 5수 요약 (사람이 읽기용) */
  playtimeDistributionHours: { min: number; q1: number; median: number; q3: number; max: number };
  /** 상위 N개가 총 플레이타임에서 차지하는 비중 (%) */
  concentration: {
    top10SharePercent: number;
    top20SharePercent: number;
    top40SharePercent: number;
  };
  /** 플레이타임 구간별 게임 수 */
  playtimeBuckets: {
    unplayed: number;
    under1h: number;
    h1to10: number;
    h10to100: number;
    over100h: number;
  };
  /** 업적 달성률이 있는 게임이 있을 때만 존재 (없으면 키 자체를 생략) */
  achievement?: {
    count: number;
    avgPercent: number;
    medianPercent: number;
    minPercent: number;
    maxPercent: number;
  };
  wishlist: { count: number; titles: string[] };
}

export const TOP_GAMES_LIMIT = 10;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function medianOf(sortedAsc: number[]): number {
  if (sortedAsc.length === 0) return 0;
  const mid = Math.floor(sortedAsc.length / 2);
  if (sortedAsc.length % 2 === 1) return sortedAsc[mid] as number;
  return ((sortedAsc[mid - 1] as number) + (sortedAsc[mid] as number)) / 2;
}

/** 상위 n개의 플레이타임 합이 전체에서 차지하는 비중 (%) */
function topSharePercent(sortedDescMinutes: number[], total: number, n: number): number {
  if (total <= 0) return 0;
  const part = sortedDescMinutes.slice(0, n).reduce((a, b) => a + b, 0);
  return round1((part / total) * 100);
}

/**
 * 정량 지표 계산 — 순수 함수, LLM·I/O 없음.
 * library에서 게임 단위 지표(총합·상위·편중·구간·업적·위시)를,
 * profile에서 취향 집계(topGenres·5수요약)를 가져온다.
 */
export function computeStats(library: LibraryIndex, profile: TasteProfile): QuantitativeStats {
  const games = library.games ?? [];
  const playtimesDesc = games.map((g) => g.playtimeMinutes).sort((a, b) => b - a);
  const total = playtimesDesc.reduce((a, b) => a + b, 0);

  const byId = new Map(games.map((g) => [g.id, g]));
  const topGames: TopGameStat[] = [...games]
    .sort((a, b) => b.playtimeMinutes - a.playtimeMinutes)
    .slice(0, TOP_GAMES_LIMIT)
    .map((g) => ({
      title: g.title,
      playtimeMinutes: g.playtimeMinutes,
      playtimeHours: round1(g.playtimeMinutes / 60),
      sharePercent: total > 0 ? round1((g.playtimeMinutes / total) * 100) : 0,
    }));

  const buckets = { unplayed: 0, under1h: 0, h1to10: 0, h10to100: 0, over100h: 0 };
  for (const g of games) {
    const m = g.playtimeMinutes;
    if (m <= 0) buckets.unplayed++;
    else if (m < 60) buckets.under1h++;
    else if (m < 600) buckets.h1to10++;
    else if (m < 6000) buckets.h10to100++;
    else buckets.over100h++;
  }

  const achRates = games
    .map((g) => g.achievementPercent)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b);
  const achievement =
    achRates.length > 0
      ? {
          count: achRates.length,
          avgPercent: round1(achRates.reduce((a, b) => a + b, 0) / achRates.length),
          medianPercent: round1(medianOf(achRates)),
          minPercent: achRates[0] as number,
          maxPercent: achRates[achRates.length - 1] as number,
        }
      : undefined;

  const wishlistIds = profile.wishlistAppIds ?? [];
  const wishlistTitles = wishlistIds
    .map((id) => byId.get(id)?.title)
    .filter((t): t is string => typeof t === 'string');

  const dist = profile.playtimeDistribution;
  const toHours = (v: number) => round1(v / 60);

  const stats: QuantitativeStats = {
    gameCount: games.length,
    totalPlaytimeMinutes: total,
    totalPlaytimeHours: round1(total / 60),
    topGames,
    genreDistribution: (profile.topGenres ?? []).map((g) => ({
      genre: g.genre,
      weight: g.weight,
      percent: round1(g.weight * 100),
    })),
    playtimeDistribution: { ...dist },
    playtimeDistributionHours: {
      min: toHours(dist.min),
      q1: toHours(dist.q1),
      median: toHours(dist.median),
      q3: toHours(dist.q3),
      max: toHours(dist.max),
    },
    concentration: {
      top10SharePercent: topSharePercent(playtimesDesc, total, 10),
      top20SharePercent: topSharePercent(playtimesDesc, total, 20),
      top40SharePercent: topSharePercent(playtimesDesc, total, 40),
    },
    playtimeBuckets: buckets,
    wishlist: { count: wishlistIds.length, titles: wishlistTitles },
  };
  if (achievement) stats.achievement = achievement;
  return stats;
}

/** 정량 지표를 LLM 프롬프트에 담는다. 지시·출력 모두 한국어. */
function buildPrompt(stats: QuantitativeStats): string {
  const topLines = stats.topGames
    .map((g, i) => `${i + 1}. ${g.title} — ${g.playtimeHours}시간 (${g.sharePercent}%)`)
    .join('\n');
  const genreLines = stats.genreDistribution
    .map((g) => `- ${g.genre}: ${g.percent}%`)
    .join('\n');
  const b = stats.playtimeBuckets;
  const ach = stats.achievement
    ? `업적 달성률 보유 게임 ${stats.achievement.count}개, 평균 ${stats.achievement.avgPercent}% (중앙값 ${stats.achievement.medianPercent}%)`
    : '업적 달성률 데이터 없음';
  return [
    '당신은 Steam 게임 라이브러리 데이터를 읽고 한 사람의 게임 취향을 분석하는 전문가입니다.',
    '아래는 실제 플레이 기록에서 계산한 정량 지표입니다. 이 숫자들을 근거로 이 사람의 게임 취향을 한국어로 분석해 주세요.',
    '',
    `총 게임 수: ${stats.gameCount}개, 총 플레이타임: ${stats.totalPlaytimeHours}시간`,
    '',
    '플레이타임 상위 게임:',
    topLines,
    '',
    '장르 분포 (플레이타임 가중):',
    genreLines || '(장르 정보 없음)',
    '',
    `플레이타임 5수 요약 (시간): 최소 ${stats.playtimeDistributionHours.min}, Q1 ${stats.playtimeDistributionHours.q1}, 중앙값 ${stats.playtimeDistributionHours.median}, Q3 ${stats.playtimeDistributionHours.q3}, 최대 ${stats.playtimeDistributionHours.max}`,
    `편중도: 상위 10개 ${stats.concentration.top10SharePercent}%, 상위 20개 ${stats.concentration.top20SharePercent}%, 상위 40개 ${stats.concentration.top40SharePercent}%`,
    `플레이 구간: 미플레이 ${b.unplayed}개, 1시간 미만 ${b.under1h}개, 1~10시간 ${b.h1to10}개, 10~100시간 ${b.h10to100}개, 100시간 이상 ${b.over100h}개`,
    ach,
    stats.wishlist.count > 0 ? `위시리스트 ${stats.wishlist.count}개: ${stats.wishlist.titles.join(', ')}` : '위시리스트 없음',
    '',
    '요청: 좋아하는 장르·플레이 성향(몰입형 vs 탐색형, 장시간 정착 vs 짧게 다양하게)을 5~10문장 한국어 문단으로 서술하세요. 숫자를 그대로 나열하지 말고 해석을 곁들이세요.',
  ].join('\n');
}

export async function analyzeLibrary(
  library: LibraryIndex,
  profile: TasteProfile,
  options?: LlmOptions,
): Promise<AnalysisReport> {
  const stats = computeStats(library, profile);

  // D3 폴백 경계: 호출 가능 판정(canCallLlm)부터. 불가하면 시도조차 하지 않는다.
  if (!options || !canCallLlm(options)) {
    return { summary: undefined, stats };
  }
  try {
    const summary = await callLlm(options, buildPrompt(stats));
    return { summary, stats };
  } catch (err) {
    warnFallback('analyze', err);
    return { summary: undefined, stats };
  }
}

// ─── JSON 사이드카 ─────────────────────────────────────────────
// 설계 의도: 곧 들어올 시계열 변화 지표가 "지난 리포트 대비"를 계산해야
// 하는데, md를 파싱하는 것보다 JSON을 읽는 게 훨씬 견고하다. M3 웹 UI도
// 같은 파일을 그대로 소비한다. 구조가 계약이 되므로 schemaVersion으로
// 버전을 박아 둔다 — 형식이 바뀌면 읽는 쪽이 구분할 수 있어야 한다.

/** 리포트 JSON 사이드카 스키마 버전. 구조가 바뀌면 올린다. */
export const REPORT_SCHEMA_VERSION = 1;

export interface AnalysisReportJson {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  /** 리포트 생성 시각 (md 헤더의 생성 시각과 동일) */
  generatedAt: string;
  stats: QuantitativeStats;
  /** 무LLM 폴백 시 키 자체를 생략 (null이 아님) */
  summary?: string;
}

export function toReportJson(report: AnalysisReport, generatedAt: Date): AnalysisReportJson {
  const json: AnalysisReportJson = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    stats: report.stats,
  };
  if (report.summary !== undefined) json.summary = report.summary;
  return json;
}
