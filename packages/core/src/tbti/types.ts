/**
 * TBTI 자리 (C-8, R1.5). 이름·입력 타입만 둔다.
 * R1.5 출력 타입 (계약 R15-3, 동결 v1.0).
 * DB·FS·HTTP·apps/web import 0.
 */
import type { GameKey } from '../types.js';
import type { GameFacts } from '../archive/types.js';
import type { Caveat } from '../recap/types.js';

export type TbtiInput = {
  games: GameFacts[];
};

/** R15-3 출력. `?`는 구간 걸침·최소 표본 미달일 때만(확정, 캡틴 N4). */
export type AxisLetter = 'I' | 'R' | 'N' | 'H' | 'O' | 'A' | 'C' | 'L' | '?';

/** 표본 미달 · 구간 걸침. 'both_weak_reserved'는 N4("N 아님=H")로 도달 불가라 삭제(O10). */
export type HeldReason = 'short_sample' | 'interval_cross';

export interface TbtiAxis {
  axis: 1 | 2 | 3 | 4;
  primary: AxisLetter;
  primaryPct: number | null;
  secondary: AxisLetter | null;
  secondaryPct: number | null;
  /** ②축만 값(N_min·N_max, %) — 근거 구간 병기(R15-5 ②)와 mini ② = N_min(R16)의 출처. ①③④ null, pending이면 null. (계약 v1.0.1 델타, A 제안 + PM 승인) */
  nInterval: { min: number; max: number } | null;
  /** 「비슷해요」(①③④ 상보축만, ②축 없음) · 「둘 다 강해요」 · 업적 미반영/부분 반영. */
  chips: ('similar' | 'both_strong' | 'ach_not_reflected' | 'ach_partial')[];
  /** of = 숨김 제외 보유 게임 수, got = 그 중 achievementState=ready 수. 디자인 「103/123편 반영」과 정합. */
  achReflected?: { got: number; of: number };
  /** 축별 상위 5행, 정렬 = metric.value 내림차순, 동률 = key 오름차순(확정 N7). 기여도 = metric 값. */
  evidence: { key: GameKey; metric: { value: number; unit: 'hours' | 'percent' | 'count' }; reasonKey: string }[];
  /**
   * 축별 정의: ① = 태그 없음+사전 빗나감 게임 수 · ② = 출시일 미확인 게임 수("증거 없음"은 분류라 제외 아님)
   * · ③ = 장르 미확인 게임 수 · ④ = 0분 제외 게임 수. caveat = 사유별 개수, excluded = 축별 합 — 중복 집계 허용.
   */
  excludedCount: number;
  held: boolean;
  heldReasonKey: HeldReason | null;
  caveats: Caveat[];
  /** ①②③ null · ④ "tbti.baseline.imc2016"(확정). 부분 반영(ach_partial)도 표시, 미반영은 생략. */
  baselineKey: string | null;
  baselineTextKey: string | null;
}

export interface TbtiResult {
  /** pending이면 "????"(R22 확정). */
  code: string;
  axes: [TbtiAxis, TbtiAxis, TbtiAxis, TbtiAxis];
  /** 전체 보류(총 5시간 미만)면 true, 4축 전부 렌더하지 않고 보류 카드(디자인 8c). */
  pending: boolean;
  /** have = 숨김 제외 confirmedMinutes 합(분). need = 300(5시간, SPEC 확정). 비보류면 null(R22). */
  pendingHours: { have: number; need: number } | null;
  /** 구성(R20, 제안): 공통 4종(observation_days·hidden_excluded·outside_steam_missing·server_record_basis) + 섹션(01~06) 코드 중 축별 caveats에 포함되지 않은 것. 축별과 중복 허용 명시. */
  caveats: Caveat[];
}

/**
 * TBTI 판정 입력 (계약 R15-1 + R15-7, 제안 — 개념 코드에는 입력 인터페이스 없음).
 * 기존 TbtiInput은 유지(C-8)하고 이 타입을 새로 둔다.
 * games는 hidden 포함 원본(core 내부 제외, R15-2 ①).
 * wishlistEnabled = preferences.tbti_wishlist, 행 없음 = on(확정).
 * now = epoch 초 — GameFacts 시각과 동일 단위(releaseDate meta.ts:24, observed 계열 sync.ts:166).
 */
export interface TbtiJudgeInput {
  games: GameFacts[];
  wishlistEnabled: boolean;
  now: number;
  seriesAliases: SeriesAliasInput;
}

/** 시리즈 별칭 주입 (PM 지정 — 웹 로더 반환 형태 그대로). */
export interface SeriesAliasInput {
  aliases: Record<string, string> | null;
  status: 'ok' | 'missing' | 'broken';
}
