/**
 * R1.5 recap 출력 타입 (계약 R15-3, 동결 v1.0).
 * 화면이 렌더할 값만 담고, 문구는 전부 i18n 키로 낸다
 * (값에 한국어 문자열을 넣지 않는다 — R1 C-10 L-1·L-3).
 * DB·FS·HTTP·apps/web import 0.
 */
import type { GameKey } from '../types.js';
import type { AxisLetter, TbtiResult } from '../tbti/types.js';
import type { GameFacts } from '../archive/types.js';

/** R15-4 맹점 고지 코드 (전부 열거, plan-r15 초기 목록). */
export type CaveatCode =
  | 'observation_days' | 'hidden_excluded' | 'outside_steam_missing'
  | 'server_record_basis' | 'genre_unknown' | 'genre_multi_overlap'
  | 'timepoint_unknown' | 'rated_only' | 'release_unknown'
  | 'release_not_purchase' | 'tag_uncollected' | 'n_covered_ratio'
  | 'n_achievements_off' | 'h_alias_file' | 'genre_tag_unknown'
  | 'ach_not_reflected' | 'ach_partial' | 'wishlist_toggle_off';

/** count null = 개수 없음(상태형). */
export interface Caveat {
  code: CaveatCode;
  count: number | null;
}

export interface RecapSectionBase {
  caveats: Caveat[];
}

/** 01. totalMinutes·share 분모 = 숨김 제외 confirmedMinutes 합(확정). */
export interface Recap01 extends RecapSectionBase {
  totalMinutes: number;
  /** 정렬 = minutes 내림차순, 동률 = key 오름차순, 5위 동점 전원 포함(확정 N6). */
  top5: { key: GameKey; minutes: number; share: number }[];
}

/** 02. game_genres 기준(확정). knownGames = 장르 확인 게임 수(비율 분모). */
export interface Recap02 extends RecapSectionBase {
  knownGames: number;
  /** 상위 8줄 + 미확인 줄(genreId "__unknown", 제안 — unknown=0이면 줄 생략, R17). 정렬 = games 내림차순, 동률 = genreId 오름차순(제안). */
  bars: { genreId: string; games: number }[];
}

/** 03. 모집단 = played(confirmedMinutes > 0)만(확정). 경계 하한 포함·상한 미포함(확정). */
export interface Recap03 extends RecapSectionBase {
  /** 현 보유 수. */
  owned: number;
  /** 그 중 >0분. */
  played: number;
  buckets: { code: 'lt2h' | 'h2_10' | 'h10_30' | 'h30_100' | 'gte100h'; games: number }[];
  /** 현 보유 중 0분. */
  unplayedKeys: GameKey[];
  /** 열린 구간 없으면 missing(재보유 공존 시 현 보유). */
  missingKeys: GameKey[];
}

/** 04. 척도 = 출력 0.5~5 실수(저장 1~10 ÷ 2). ratedCount = 현 보유 중 ratings 행 있음. */
export interface Recap04 extends RecapSectionBase {
  ratedCount: number;
  /** 내 별점 평균(매긴 게임만, 확정). null 시 홈 별점 칸은 "별점을 매기면 보여요" 한 줄로 렌더(제안). */
  mean: number | null;
  /** dist10[i] = 0.5×(i+1)점 게임 수(0.5~5 오름차순 10칸, R17). */
  dist10: number[];
  /** |dev| ≥ 1.0 중 편차 상위 각 3행(확정 — 3 미만이면 있는 만큼, R17). 동률 = |dev| 내림차순 후 key 오름차순(제안). */
  high: { key: GameKey; score: number; dev: number }[];
  low: { key: GameKey; score: number; dev: number }[];
}

/** 05. 환산: new = [당해, 당해], recent = [당해−7, 당해−1], classic = [하한 없음, 당해−8]. 당해 = UTC 연도(now). */
export interface Recap05 extends RecapSectionBase {
  /** fromYear null = 하한 없음(C14 — classic의 열린 쪽은 하한이다). toYear null = 상한 없음. */
  bands: { code: 'new' | 'recent' | 'classic'; fromYear: number | null; toYear: number | null; games: number }[];
}

/** 06. years = 출시연도 오름차순, 데이터 min~max(디자인 18칸은 예시값). */
export interface Recap06 extends RecapSectionBase {
  years: { year: number; games: number }[];
  /** now ≥ createdAt + 365일(확정 — "설치 2년차(설치 1년 뒤)부터"). */
  comparePrevYear: boolean;
}

/** recap 07 요약 카드용. mini 막대는 장식 수준(수치 미표시)이나 데이터는 pct를 싣는다. ②축 mini = N_min(분기표 정합), `?`축 = null(R16). */
export interface TbtiCardSummary {
  code: string;
  pending: boolean;
  letters: [AxisLetter, AxisLetter, AxisLetter, AxisLetter];
  mini: { axis: 1 | 2 | 3 | 4; pct: number | null }[];
}

export interface LibraryRecap {
  /** observedDays = owned 소스 ok run의 observedDay distinct 수(R20). 0건이면 0 + 관측 0일 띠 문구. firstObservedAt = epoch 초, null = 관측 0건. basis 렌더는 i18n. */
  basis: { observedDays: number; firstObservedAt: number | null };
  s01: Recap01;
  s02: Recap02;
  s03: Recap03;
  s04: Recap04;
  s05: Recap05;
  s06: Recap06;
  tbti: TbtiCardSummary;
}

/**
 * 리캡 집계 입력 (계약 R15-1 + R20, 제안 — 개념 코드에는 입력 인터페이스 없음).
 * games는 hidden 포함 원본 — core 내부에서 hidden 제외 필터를 건다(R15-2 ①).
 * tbti: 판정 1회 원칙 — 웹이 judge 후 recap 호출. LibraryRecap.tbti 요약의 원천.
 */
export interface RecapInput {
  games: GameFacts[];
  /** epoch 초 — account.createdAt 저장 단위와 동일(apps/web/src/data/connection.ts:145, Math.floor(Date.now()/1000)). null = 미확인. */
  accountCreatedAt: number | null;
  /** epoch 초 — GameFacts 시각과 동일 단위(releaseDate meta.ts:24 isoToUtcDayEpoch, observed 계열 sync.ts:166). */
  now: number;
  /** owned 소스 ok run의 observedDay distinct — 웹이 sync_runs에서 조립. basis.observedDays의 직접 입력(R20). */
  ownedObservedDays: string[];
  tbti: TbtiResult;
}
