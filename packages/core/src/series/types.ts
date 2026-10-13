/**
 * T3 시리즈 판별 — 타입 (계약 R15-6, 동결 v1.0).
 * T2(TBTI 판정)가 소비할 게임별 묶음 귀속을 반환한다.
 * DB·FS·HTTP·Date·Random·apps/web import 0.
 */
import type { GameKey } from '../types.js';
import type { GameFacts } from '../archive/types.js';
import type { SeriesAliasInput } from '../tbti/types.js';

/** T2가 주입하는 별칭 입력 형태는 TbtiJudgeInput.seriesAliases와 동일 — tbti/types.ts가 정본이다. */

/** 묶음 귀속 경로: 별칭 조회 적중 · 코어 동등 · 개발사 보조 병합. */
export type SeriesBundleVia = 'alias' | 'core' | 'core-dev';

/** 별칭 파일이 실제로 쓰인 출처. 'file' = 주입 ok, 'builtin' = missing 시 부록 A, 'none' = broken 시 별칭 없음. */
export type SeriesAliasSource = 'file' | 'builtin' | 'none';

/** 게임 1편의 묶음 귀속. normalized = ③ 숫자 통일 후 정규화명(별칭 조회 키), core = ④ 코어. */
export interface SeriesGameBundle {
  key: GameKey;
  normalized: string;
  core: string;
  bundleId: string;
  via: SeriesBundleVia;
}

/** 묶음 1건. size = 귀속 게임 수. T2는 size ≥ SERIES_MIN_BUNDLE_SIZE인 묶음을 H 근거로 쓴다. */
export interface SeriesBundle {
  bundleId: string;
  via: SeriesBundleVia;
  size: number;
  keys: GameKey[];
}

/** judgeSeriesBundles 결과. */
export interface SeriesJudgeResult {
  /** hidden 제외 후 게임별 귀속 — key(platform·externalId) 오름차순 고정. */
  items: SeriesGameBundle[];
  /** bundleId 오름차순 고정. */
  bundles: SeriesBundle[];
  aliasSource: SeriesAliasSource;
  /** bundles.length와 동일(편의). */
  bundleCount: number;
  /** via='alias'인 묶음 수 — TBTI ②축 caveat h_alias_file(별칭 묶음 수)의 입력. */
  aliasBundleCount: number;
  /** 입력 단계에서 제외한 hidden 게임 수(R15-2 ①). */
  hiddenExcluded: number;
}

/** judgeSeriesBundles 입력. games는 hidden 포함 원본(core 내부 제외, R15-2 ①). */
export interface SeriesJudgeInput {
  games: GameFacts[];
  seriesAliases: SeriesAliasInput;
}
