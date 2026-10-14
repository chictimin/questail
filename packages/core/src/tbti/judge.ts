/**
 * T2 TBTI 판정 (계약 R15-5·R15-4, v1.1: F-05 증거① 교체·F-15 nInterval·
 * F-27 achReflected·F-30 genre 1코드·F-39 ready 2편·F-43 lastPlayed 0 + metrics·gameLetters·aliasStatus).
 * 순수 함수 — DB·FS·HTTP·Date.now·Math.random·apps/web import 0. series import는 core 내부라 허용.
 * 입력 TbtiJudgeInput.games는 hidden 포함 원본 — 내부에서 hidden 제외 후 집계한다(R15-2 ①).
 * 16유형 이름·리캡 섹션·웹은 범위 밖이다.
 * reasonKey·heldReasonKey·baselineKey·baselineTextKey는 i18n 키 문자열(값 정의는 제안).
 */
import type { GameKey } from '../types.js';
import type { GameFacts } from '../archive/types.js';
import type { Caveat } from '../recap/types.js';
import type { AxisLetter, ReasonKey, TbtiAxis, TbtiJudgeInput, TbtiResult } from './types.js';
import { judgeSeriesBundles } from '../series/judge.js';
import {
  TBTI_BASELINE_IMC2016_KEY,
  TBTI_BASELINE_IMC2016_TEXT_KEY,
  TBTI_CL_BOUNDARY_PCT,
  TBTI_EVIDENCE_ROWS,
  TBTI_H_BOUNDARY_PCT,
  TBTI_IR_BOUNDARY_PCT,
  TBTI_IR_TAGS_I,
  TBTI_IR_TAGS_R,
  TBTI_MEDIAN_CAP_HOURS,
  TBTI_MIN_SAMPLE_CL_PROXY,
  TBTI_MIN_SAMPLE_CL_READY,
  TBTI_MIN_SAMPLE_IR_PIECES,
  TBTI_MIN_SAMPLE_NH_KNOWN,
  TBTI_MIN_SAMPLE_OA_KNOWN,
  TBTI_NEW_WINDOW_SECONDS,
  TBTI_N_BOUNDARY_PCT,
  TBTI_OA_BOUNDARY_PCT,
  TBTI_PENDING_NEED_MINUTES,
  TBTI_QUIT_MINUTES,
  TBTI_QUIT_RECENCY_SECONDS,
  TBTI_SIMILAR_TOLERANCE_PCT,
} from './constants.js';

/** R15-5 ① 매칭 규칙(제안, C12): 대소문자 무시 정확 일치(태그 문자열 단위). 부분일치 금지. */
const IR_I_SET = new Set(TBTI_IR_TAGS_I.map((tag) => tag.toLowerCase()));
/** R15-5 ① 매칭 규칙(제안, C12): Souls-like/Souls-Like 중복은 소문자화 후 동일 키라 무해한 잉여다. */
const IR_R_SET = new Set(TBTI_IR_TAGS_R.map((tag) => tag.toLowerCase()));

/** i18n 키 제안 — ①축 행 사유. 값 정의는 범위 밖(웹 i18n). */
export const TBTI_REASON_IR_I_ONLY : ReasonKey = 'tbti.reason.ir.i_only';
export const TBTI_REASON_IR_R_ONLY : ReasonKey = 'tbti.reason.ir.r_only';
export const TBTI_REASON_IR_BOTH : ReasonKey = 'tbti.reason.ir.both';
/** i18n 키 제안 — ②축 행 사유(게임별 N 분류). */
export const TBTI_REASON_NH_CONFIRMED_SNAPSHOT : ReasonKey = 'tbti.reason.nh.confirmed_snapshot';
export const TBTI_REASON_NH_CONFIRMED_UNLOCK : ReasonKey = 'tbti.reason.nh.confirmed_unlock';
export const TBTI_REASON_NH_CONFIRMED_LASTPLAYED : ReasonKey = 'tbti.reason.nh.confirmed_lastplayed';
export const TBTI_REASON_NH_CONFIRMED_WISHLIST : ReasonKey = 'tbti.reason.nh.confirmed_wishlist';
export const TBTI_REASON_NH_LATE : ReasonKey = 'tbti.reason.nh.late';
export const TBTI_REASON_NH_NO_EVIDENCE : ReasonKey = 'tbti.reason.nh.no_evidence';
/** i18n 키 제안 — ③축 행 사유. */
export const TBTI_REASON_OA_GENRE : ReasonKey = 'tbti.reason.oa.genre';
/** i18n 키 제안 — ④축 행 사유(업적 반영 게임 vs 시간만 반영 게임). */
export const TBTI_REASON_CL_ACH_READY : ReasonKey = 'tbti.reason.cl.ach_ready';
export const TBTI_REASON_CL_HOURS_ONLY : ReasonKey = 'tbti.reason.cl.hours_only';

/** 결정적 키 순서 — platform → externalId 바이트 비교(localeCompare 금지, R15-6 T3와 동일 규칙). */
function compareGameKey(a: GameKey, b: GameKey): number {
  if (a.platform !== b.platform) return a.platform < b.platform ? -1 : 1;
  if (a.externalId !== b.externalId) return a.externalId < b.externalId ? -1 : 1;
  return 0;
}

function gameKeyOf(game: GameFacts): string {
  return `${game.key.platform}\0${game.key.externalId}`;
}

function itemKeyOf(key: GameKey): string {
  return `${key.platform}\0${key.externalId}`;
}

/** ②축 게임별 N 시간 분류 (계약 R15-5 ②, 제안 — C13 늦음/증거없음 분할). */

/** similar = 주·부 차이 ±10% 이내. 부동소수점 경계(정확히 10) 오판을 막기 위해 엡실론을 둔다. */
function isSimilar(primaryPct: number, secondaryPct: number): boolean {
  return Math.abs(primaryPct - secondaryPct) <= TBTI_SIMILAR_TOLERANCE_PCT + 1e-9;
}

/** ②축 게임별 N 시간 분류 (계약 R15-5 ②, 제안 — C13 늦음/증거없음 분할). */
type NhBucket = 'confirmed' | 'late' | 'no_evidence';

interface NhClass {
  confirmed: number;
  late: number;
  none: number;
  bucket: NhBucket;
  confirmedVia: 'snapshot' | 'unlock' | 'lastplayed' | 'wishlist' | null;
}

/**
 * R15-5 ② N 증거 순서(확정): ①첫 성공 스냅샷 observedAt ≤ 출시+W(기준선 여부 무관, F-05)
 * ②가장 이른 unlocked_at ≤ 출시+W ③lastPlayed ≤ 출시+W(0은 NULL, F-43),
 * 보조 출시 전 찜(wishlistEnabled on일 때만).
 * N 확정 시간(확정 — 캡틴 결정 1): 시작 증거가 있는 게임은 confirmedMinutes 전액을 확정으로 센다.
 * "W 이후분은 분모에만" 규칙·v1.0.5 게이트(기준선total+deltas 상한)는 폐기한다.
 * fallback 3행(제안): ② 미달성·unlocked_at NULL 행 제외 후 min, 해당 없음이면 확정 기여 0 ·
 * ③ lastPlayed NULL이면 증거 없음 · 보조는 dateAdded non-null이면 그것, NULL이면 firstObservedAt.
 */
function classifyNh(
  game: GameFacts,
  cutoff: number | null,
  wishlistEnabled: boolean,
): NhClass {
  const total = game.confirmedMinutes;
  // 출시일 미확인 → 전액 증거 없음(계약 R15-5 ② "출시일 미확인 포함").
  if (cutoff === null || game.releaseDate === null) {
    return { confirmed: 0, late: 0, none: total, bucket: 'no_evidence', confirmedVia: null };
  }
  // 증거 ①(확정): 그 게임의 첫 성공 스냅샷 observedAt ≤ 출시+W이면(기준선 여부 무관) 전액 확정.
  if (game.snapshots.length > 0) {
    const first = [...game.snapshots].sort((a, b) => a.observedAt - b.observedAt)[0] as GameFacts['snapshots'][number];
    if (first.observedAt <= cutoff) {
      return { confirmed: total, late: 0, none: 0, bucket: 'confirmed', confirmedVia: 'snapshot' };
    }
  }

  // 증거 ②: 미달성·unlocked_at NULL 행 제외 후 min.
  let earliestUnlock: number | null = null;
  for (const ach of game.achievements) {
    if (!ach.achieved || ach.unlockedAt === null) continue;
    if (earliestUnlock === null || ach.unlockedAt < earliestUnlock) {
      earliestUnlock = ach.unlockedAt;
    }
  }
  // 보조: 출시 전 찜. span 종료 포함 전 구간(R15) — ended 여부와 무관하게 전 wishlist 행을 본다.
  let preReleaseWish = false;
  if (wishlistEnabled) {
    for (const span of game.wishlist) {
      const anchor = span.dateAdded ?? span.firstObservedAt;
      if (anchor < game.releaseDate) {
        preReleaseWish = true;
        break;
      }
    }
  }

  if (earliestUnlock !== null && earliestUnlock <= cutoff) {
    return { confirmed: total, late: 0, none: 0, bucket: 'confirmed', confirmedVia: 'unlock' };
  }
  // 증거 ③: lastPlayed ≤ 출시+W. lastPlayed NULL이면 증거 없음(R15).
  // lastPlayed 0은 NULL과 같게 취급한다(F-43 — 미플레이 last_played = 0 저장).
  // lastPlayed > W 단독은 늦음 근거가 아니다(C13).
  const lastPlayed = game.lastPlayed === 0 ? null : game.lastPlayed;
  if (lastPlayed !== null && lastPlayed <= cutoff) {
    return { confirmed: total, late: 0, none: 0, bucket: 'confirmed', confirmedVia: 'lastplayed' };
  }
  // 보조는 증거 없음→확정 재분류 용도로만. N 확정 시간 가산 없음(R15-7).
  if (preReleaseWish) {
    return { confirmed: total, late: 0, none: 0, bucket: 'confirmed', confirmedVia: 'wishlist' };
  }
  // 늦음 = min unlocked_at > 출시+W인 게임의 전액 시간(늦게 시작 추정, SPEC-tbti 79행).
  if (earliestUnlock !== null && earliestUnlock > cutoff) {
    return { confirmed: 0, late: total, none: 0, bucket: 'late', confirmedVia: null };
  }
  // 증거 없음 = 그 외 비확정(증거 경로 전부 없음 — 첫 관측이 W 이후 시작 포함 · 출시일 미확인 포함).
  return { confirmed: 0, late: 0, none: total, bucket: 'no_evidence', confirmedVia: null };
}

/** visible 전 게임의 ②축 분류 1회 계산(판정·gameLetters 공유, 결정성 유지). */
function classifyAllNh(
  visible: GameFacts[],
  wishlistEnabled: boolean,
): Map<string, NhClass> {
  const classes = new Map<string, NhClass>();
  for (const game of visible) {
    const cutoff =
      game.releaseDate === null ? null : game.releaseDate + TBTI_NEW_WINDOW_SECONDS;
    classes.set(gameKeyOf(game), classifyNh(game, cutoff, wishlistEnabled));
  }
  return classes;
}

function nhReasonKey(bucket: NhBucket, confirmedVia: NhClass['confirmedVia']): ReasonKey {
  if (bucket === 'late') return TBTI_REASON_NH_LATE;
  if (bucket === 'no_evidence') return TBTI_REASON_NH_NO_EVIDENCE;
  switch (confirmedVia) {
    case 'snapshot':
      return TBTI_REASON_NH_CONFIRMED_SNAPSHOT;
    case 'lastplayed':
      return TBTI_REASON_NH_CONFIRMED_LASTPLAYED;
    case 'wishlist':
      return TBTI_REASON_NH_CONFIRMED_WISHLIST;
    case 'unlock':
    default:
      return TBTI_REASON_NH_CONFIRMED_UNLOCK;
  }
}

/** ①축 게임별 태그 편(판정·gameLetters 공유). ready 판정은 호출자가 한다. */
function tagSide(game: GameFacts): 'I' | 'R' | 'both' | 'none' {
  const lowered = new Set(game.tags.map((entry) => entry.tag.toLowerCase()));
  let hasI = false;
  let hasR = false;
  for (const tag of lowered) {
    if (IR_I_SET.has(tag)) hasI = true;
    if (IR_R_SET.has(tag)) hasR = true;
  }
  if (hasI && hasR) return 'both';
  if (hasI) return 'I';
  if (hasR) return 'R';
  return 'none';
}

/** ①축. 최소 표본: 판정 게임 3편(집중3). */
function judgeAxis1(
  visible: GameFacts[],
  hiddenExcluded: number,
): TbtiAxis {
  const tagUncollected = visible.filter((game) => game.tagStatus !== 'ready').length;
  // tagStatus=failed 보존 태그는 ① 집계에 쓰지 않고 제외한다(R13).
  type Piece = { game: GameFacts; iPiece: number; rPiece: number };
  const pieces: Piece[] = [];
  for (const game of visible) {
    if (game.tagStatus !== 'ready') continue;
    // 둘 다 → 양쪽 0.5편씩(SPEC 확정). 사전에 하나도 안 걸리면 판정 제외 + excludedCount.
    const side = tagSide(game);
    if (side === 'both') pieces.push({ game, iPiece: 0.5, rPiece: 0.5 });
    else if (side === 'I') pieces.push({ game, iPiece: 1, rPiece: 0 });
    else if (side === 'R') pieces.push({ game, iPiece: 0, rPiece: 1 });
  }
  const iPieces = pieces.reduce((sum, row) => sum + row.iPiece, 0);
  const rPieces = pieces.reduce((sum, row) => sum + row.rPiece, 0);
  const sample = iPieces + rPieces;
  // excludedCount ① = 태그 없음+사전 빗나감 게임 수(R15-3).
  const excludedCount = visible.length - pieces.length;
  const caveats: Caveat[] = [
    { code: 'hidden_excluded', count: hiddenExcluded },
    { code: 'tag_uncollected', count: tagUncollected },
  ];
  // metrics ①(확정 — 캡틴 결정 2): I/R 편 합(둘다는 0.5씩, 판정 원값) · 판정게임수.
  const metrics = {
    kind: 'ir' as const,
    iGames: iPieces,
    rGames: rPieces,
    judgedGames: pieces.length,
  };
  const base = {
    axis: 1 as const,
    nInterval: null,
    excludedCount,
    caveats,
    baselineKey: null,
    baselineTextKey: null,
    metrics,
  };
  if (sample < TBTI_MIN_SAMPLE_IR_PIECES) {
    return {
      ...base,
      primary: '?',
      primaryPct: null,
      secondary: null,
      secondaryPct: null,
      chips: [],
      evidence: topIrEvidence(pieces, null),
      held: true,
      heldReasonKey: 'short_sample',
    };
  }
  // I_pct = I편 ÷ (I편 + R편) × 100, R은 100 − I_pct(상보). 경계 50. 동률(정확히 50)은 I.
  const iPct = (iPieces / sample) * 100;
  const primary: AxisLetter = iPct >= TBTI_IR_BOUNDARY_PCT ? 'I' : 'R';
  const primaryPct = primary === 'I' ? iPct : 100 - iPct;
  const secondary: AxisLetter = primary === 'I' ? 'R' : 'I';
  const secondaryPct = 100 - primaryPct;
  // similar = 주·부 차이 ±10% 이내(SPEC 확정 — ①③④ 상보축만).
  const chips: TbtiAxis['chips'] = isSimilar(primaryPct, secondaryPct) ? ['similar'] : [];
  return {
    ...base,
    primary,
    primaryPct,
    secondary,
    secondaryPct,
    chips,
    evidence: topIrEvidence(pieces, primary),
    held: false,
    heldReasonKey: null,
  };
}

/** ①축 evidence — primary 기여 편(piece) 내림차순 · 동률 key 오름차순. held면 기여 전원(최대 5). */
function topIrEvidence(
  pieces: { game: GameFacts; iPiece: number; rPiece: number }[],
  primary: AxisLetter | null,
): TbtiAxis['evidence'] {
  const rows = pieces
    .map((row) => {
      const value = primary === 'R' ? row.rPiece : row.iPiece;
      const reasonKey =
        row.iPiece > 0 && row.rPiece > 0
          ? TBTI_REASON_IR_BOTH
          : row.iPiece > 0
            ? TBTI_REASON_IR_I_ONLY
            : TBTI_REASON_IR_R_ONLY;
      return { game: row.game, value, reasonKey };
    })
    .filter((row) => primary === null || row.value > 0)
    .sort(
      (a, b) => b.value - a.value || compareGameKey(a.game.key, b.game.key),
    )
    .slice(0, TBTI_EVIDENCE_ROWS);
  return rows.map((row) => ({
    key: row.game.key,
    metric: { value: row.value, unit: 'count' as const },
    reasonKey: row.reasonKey,
  }));
}

/** ②축 metrics bundles 항목(확정 M1 — 상위 3묶음, 시간 내림차순·동률 bundleId 오름차순). */
interface NhBundleStat {
  id: string;
  games: number;
  minutes: number;
  representativeKey: GameKey;
}

/** ②축. 최소 표본: 출시일 확인 게임 3편(시기3). ②축 similar 없음(절대 금지). */
function judgeAxis2(
  visible: GameFacts[],
  hiddenExcluded: number,
  totalMinutes: number,
  wishlistEnabled: boolean,
  hMinutes: number,
  aliasBundleCount: number,
  bundlesTop3: NhBundleStat[],
): TbtiAxis {
  const known = visible.filter((game) => game.releaseDate !== null);
  // excludedCount ② = 출시일 미확인 게임 수("증거 없음"은 분류라 제외 아님, R15-3).
  const excludedCount = visible.length - known.length;
  const classes = classifyAllNh(visible, wishlistEnabled);
  let confirmedSum = 0;
  let noneSum = 0;
  for (const cls of classes.values()) {
    confirmedSum += cls.confirmed;
    noneSum += cls.none;
  }
  // 분모 "전체 시간"(확정): 숨김 제외 confirmedMinutes 합.
  const nMin = totalMinutes > 0 ? (confirmedSum / totalMinutes) * 100 : 0;
  const nMax = totalMinutes > 0 ? ((confirmedSum + noneSum) / totalMinutes) * 100 : 0;
  const hPct = totalMinutes > 0 ? (hMinutes / totalMinutes) * 100 : 0;
  // 업적 꺼지면 구간이 넓어짐 — visible 중 disabled 1건 이상이면 상태 고지(제안).
  const hasDisabled = visible.some((game) => game.achievementState === 'disabled');
  const caveats: Caveat[] = [
    { code: 'hidden_excluded', count: hiddenExcluded },
    { code: 'release_unknown', count: excludedCount },
    // n_covered_ratio: N 판정에 쓴 시간 n% = 확정÷전체(SPEC "카드 근거에 판정에 쓴 시간 n%").
    { code: 'n_covered_ratio', count: nMin },
    ...(hasDisabled ? [{ code: 'n_achievements_off' as const, count: null }] : []),
    // h_alias_file: 별칭 묶음 수(T3 aliasBundleCount).
    { code: 'h_alias_file', count: aliasBundleCount },
    ...(wishlistEnabled ? [] : [{ code: 'wishlist_toggle_off' as const, count: null }]),
  ];
  const evidence = [...visible]
    .filter((game) => game.confirmedMinutes > 0)
    .map((game) => {
      const cls = classes.get(gameKeyOf(game)) as NhClass;
      return { game, cls };
    })
    .sort(
      (a, b) =>
        b.game.confirmedMinutes - a.game.confirmedMinutes ||
        compareGameKey(a.game.key, b.game.key),
    )
    .slice(0, TBTI_EVIDENCE_ROWS)
    .map((row) => ({
      key: row.game.key,
      metric: { value: row.game.confirmedMinutes / 60, unit: 'hours' as const },
      reasonKey: nhReasonKey(row.cls.bucket, row.cls.confirmedVia),
    }));
  // metrics ②(확정 — 캡틴 결정 2): 상위 3묶음 + N 구간 원값.
  const metrics = {
    kind: 'nh' as const,
    bundles: bundlesTop3,
    nMin,
    nMax,
  };
  const base = {
    axis: 2 as const,
    excludedCount,
    caveats,
    baselineKey: null,
    baselineTextKey: null,
    evidence,
    metrics,
  };
  if (known.length < TBTI_MIN_SAMPLE_NH_KNOWN) {
    // short_sample 보류는 nInterval null 유지(F-15 — interval_cross만 싣는다).
    return {
      ...base,
      primary: '?',
      primaryPct: null,
      secondary: null,
      secondaryPct: null,
      nInterval: null,
      chips: [],
      held: true,
      heldReasonKey: 'short_sample',
    };
  }
  // ② 분기표(확정 — 캡틴 N4, O7 대칭 정리).
  if (nMin >= TBTI_N_BOUNDARY_PCT) {
    const bothStrong =
      nMin >= TBTI_N_BOUNDARY_PCT && hPct >= TBTI_H_BOUNDARY_PCT;
    return {
      ...base,
      primary: 'N',
      primaryPct: nMin,
      secondary: 'H',
      secondaryPct: hPct,
      nInterval: { min: nMin, max: nMax },
      chips: bothStrong ? ['both_strong'] : [],
      held: false,
      heldReasonKey: null,
    };
  }
  if (nMax < TBTI_N_BOUNDARY_PCT) {
    // N 아님 = H. primaryPct = 100−N_max(신작 아닌 비중, 항상 50% 초과 — 확정 D1).
    // secondary H·secondaryPct H_pct — 계약 문자 그대로.
    return {
      ...base,
      primary: 'H',
      primaryPct: 100 - nMax,
      secondary: 'H',
      secondaryPct: hPct,
      nInterval: { min: nMin, max: nMax },
      chips: [],
      held: false,
      heldReasonKey: null,
    };
  }
  // N=? (구간이 경계에 걸침). 구간 걸침 보류 ②축도 nInterval을 싣는다(F-15, H 작은 줄 유지).
  // short_sample 보류·전체 보류(pending)는 null 유지.
  if (hPct >= TBTI_H_BOUNDARY_PCT) {
    return {
      ...base,
      primary: '?',
      primaryPct: null,
      secondary: 'H',
      secondaryPct: hPct,
      nInterval: { min: nMin, max: nMax },
      chips: [],
      held: true,
      heldReasonKey: 'interval_cross',
    };
  }
  return {
    ...base,
    primary: '?',
    primaryPct: null,
    secondary: null,
    secondaryPct: null,
    nInterval: { min: nMin, max: nMax },
    chips: [],
    held: true,
    heldReasonKey: 'interval_cross',
  };
}

/** ③축. 최소 표본: 장르 확인 게임 3편(폭3). game_user_tags는 ①축과 이중 계산되므로 쓰지 않는다. */
function judgeAxis3(
  visible: GameFacts[],
  hiddenExcluded: number,
): TbtiAxis {
  const perGame = visible.map((game) => ({
    game,
    genreIds: [...new Set(game.genres.map((genre) => genre.genreId))],
  }));
  const known = perGame.filter((row) => row.genreIds.length > 0);
  // excludedCount ③ = 장르 미확인 게임 수(R15-3).
  const excludedCount = visible.length - known.length;
  const caveats: Caveat[] = [
    { code: 'hidden_excluded', count: hiddenExcluded },
    // 장르 미확인은 genre_unknown 1코드로만 싣는다(F-30 — genre_tag_unknown 방출 제거).
    { code: 'genre_unknown', count: excludedCount },
  ];
  const evidence = [...known]
    .sort(
      (a, b) =>
        b.genreIds.length - a.genreIds.length || compareGameKey(a.game.key, b.game.key),
    )
    .slice(0, TBTI_EVIDENCE_ROWS)
    .map((row) => ({
      key: row.game.key,
      metric: { value: row.genreIds.length, unit: 'count' as const },
      reasonKey: TBTI_REASON_OA_GENRE,
    }));
  // share 정의(확정 구조): 장르 배정 총수 분모(겹침 명시). HHI 본식(확정 구조, C11): HHI = Σ share_g².
  // metrics ③(확정 — 캡틴 결정 2): HHI 원값 · 장르 종류 수. held(표본 미달)에도 싣는다.
  const assignments = known.reduce((sum, row) => sum + row.genreIds.length, 0);
  const counts = new Map<string, number>();
  for (const row of known) {
    for (const genreId of row.genreIds) {
      counts.set(genreId, (counts.get(genreId) ?? 0) + 1);
    }
  }
  // G = 그 사용자 장르 종류 수. 최소 표본(폭3)이 G≥1을 보장한다(C11).
  const distinct = counts.size;
  let hhi = 0;
  for (const count of counts.values()) {
    const share = count / assignments;
    hhi += share * share;
  }
  const metrics = { kind: 'oa' as const, hhi, g: distinct };
  const base = {
    axis: 3 as const,
    nInterval: null,
    excludedCount,
    caveats,
    baselineKey: null,
    baselineTextKey: null,
    evidence,
    metrics,
  };
  if (known.length < TBTI_MIN_SAMPLE_OA_KNOWN) {
    return {
      ...base,
      primary: '?',
      primaryPct: null,
      secondary: null,
      secondaryPct: null,
      chips: [],
      held: true,
      heldReasonKey: 'short_sample',
    };
  }
  // 변환식(제안): A_pct = (1 − HHI_norm) × 100. G=1(완전 원툴) → A=0 고정(C11).
  let aPct: number;
  if (distinct <= 1) {
    aPct = 0;
  } else {
    const hhiNorm = (hhi - 1 / distinct) / (1 - 1 / distinct);
    aPct = (1 - hhiNorm) * 100;
  }
  const oPct = 100 - aPct;
  const primary: AxisLetter = oPct >= TBTI_OA_BOUNDARY_PCT ? 'O' : 'A';
  const primaryPct = primary === 'O' ? oPct : aPct;
  const secondary: AxisLetter = primary === 'O' ? 'A' : 'O';
  const secondaryPct = 100 - primaryPct;
  const chips: TbtiAxis['chips'] = isSimilar(primaryPct, secondaryPct) ? ['similar'] : [];
  return {
    ...base,
    primary,
    primaryPct,
    secondary,
    secondaryPct,
    chips,
    held: false,
    heldReasonKey: null,
  };
}

/** ④축 목표 게임의 업적 달성률(0~100). summary 우선, 없으면 배열 계산. 산출 불가면 null(0% 환산 금지). */
function achievementRate(game: GameFacts): number | null {
  if (game.achievementSummary !== null && game.achievementSummary.total > 0) {
    return (game.achievementSummary.achieved / game.achievementSummary.total) * 100;
  }
  if (game.achievements.length > 0) {
    const got = game.achievements.filter((ach) => ach.achieved).length;
    return (got / game.achievements.length) * 100;
  }
  return null;
}

/** ④축. 대상 = confirmedMinutes > 0만. 0분은 미플레이이지 찍먹이 아니다(제안). */
function judgeAxis4(
  visible: GameFacts[],
  hiddenExcluded: number,
  now: number,
): TbtiAxis {
  const target = visible.filter((game) => game.confirmedMinutes > 0);
  // excludedCount ④ = 0분 제외 게임 수(R15-3).
  const excludedCount = visible.length - target.length;
  // (a) 중앙값 점수: min(100, 100 × log10(1+중앙값_h) ÷ log10(1+500)).
  const hours = target
    .map((game) => game.confirmedMinutes / 60)
    .sort((a, b) => a - b);
  let medianHours = 0;
  let scoreA = 0;
  if (hours.length > 0) {
    const mid = Math.floor(hours.length / 2);
    medianHours =
      hours.length % 2 === 1
        ? (hours[mid] as number)
        : ((hours[mid - 1] as number) + (hours[mid] as number)) / 2;
    scoreA = Math.min(
      100,
      (100 * Math.log10(1 + medianHours)) / Math.log10(1 + TBTI_MEDIAN_CAP_HOURS),
    );
  }
  // (b) 업적 달성률 점수 = ready 게임별 달성률의 산술평균(母집단 = ready, C10).
  // ④ 업적 재료는 ready 게임 2편 이상일 때만 쓴다. 미만이면 2재료(a·c) 평균 + ach_partial(F-39).
  const readyTarget = target.filter((game) => game.achievementState === 'ready');
  const rates: number[] = [];
  for (const game of readyTarget) {
    const rate = achievementRate(game);
    if (rate !== null) rates.push(rate);
  }
  const useAch = readyTarget.length >= TBTI_MIN_SAMPLE_CL_READY && rates.length > 0;
  const achMean = useAch
    ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length
    : null;
  // (c) 그만둔 비율 역점수. 그만둔 = confirmedMinutes < 2시간かつlastPlayed가 90일 전(확정 N3).
  // lastPlayed NULL이면 최근성 미충족 → 그만둠 아님(R15). lastPlayed 0은 NULL과 같게 취급(F-43).
  const quitCutoff = now - TBTI_QUIT_RECENCY_SECONDS;
  let quitCount = 0;
  for (const game of target) {
    const lastPlayed = game.lastPlayed === 0 ? null : game.lastPlayed;
    if (
      game.confirmedMinutes < TBTI_QUIT_MINUTES &&
      lastPlayed !== null &&
      lastPlayed <= quitCutoff
    ) {
      quitCount += 1;
    }
  }
  const scoreC = target.length > 0 ? 100 - (quitCount / target.length) * 100 : 0;
  // achReflected(F-27): of = 숨김 제외 · 플레이한(>0분) · 업적이 있는(achievementState empty 아님) 게임 수,
  // got = 그중 ready. ach_partial 표시는 got/of 둘 다(F-30 — count = got).
  const ofGames = target.filter((game) => game.achievementState !== 'empty');
  const of = ofGames.length;
  const got = ofGames.filter((game) => game.achievementState === 'ready').length;
  const achReflected = { got, of };
  // off/실패/미수집 게임의 업적률은 0%로 바꾸지 않고 남은 2개 재료(a·c) 평균 + 칩·안내(확정).
  const score = useAch && achMean !== null ? (scoreA + achMean + scoreC) / 3 : (scoreA + scoreC) / 2;
  const evidence = [...target]
    .sort(
      (a, b) => b.confirmedMinutes - a.confirmedMinutes || compareGameKey(a.key, b.key),
    )
    .slice(0, TBTI_EVIDENCE_ROWS)
    .map((game) => ({
      key: game.key,
      metric: { value: game.confirmedMinutes / 60, unit: 'hours' as const },
      reasonKey:
        game.achievementState === 'ready'
          ? TBTI_REASON_CL_ACH_READY
          : TBTI_REASON_CL_HOURS_ONLY,
    }));
  // 최소 표본 "업적 반영 2편" = ready 2편(F-39) · 대리 3편 = 대상 게임 3편.
  const sampleOk =
    readyTarget.length >= TBTI_MIN_SAMPLE_CL_READY || target.length >= TBTI_MIN_SAMPLE_CL_PROXY;
  // metrics ④(확정 — 캡틴 결정 2): 중앙값 시간 · 업적 평균(2재료 판정이면 null) · 그만둠 수/분모.
  const metrics = {
    kind: 'cl' as const,
    medianHours,
    achMean,
    quitCount,
    quitDenom: target.length,
  };
  const base = {
    axis: 4 as const,
    nInterval: null,
    excludedCount,
    evidence,
    metrics,
  };
  if (!sampleOk) {
    return {
      ...base,
      primary: '?',
      primaryPct: null,
      secondary: null,
      secondaryPct: null,
      chips: [],
      held: true,
      heldReasonKey: 'short_sample',
      // held(표본 미달)는 판정이 없으므로 achMean null — medianHours·quitCount·quitDenom은 원값 그대로.
      caveats: [{ code: 'hidden_excluded', count: hiddenExcluded }],
      baselineKey: null,
      baselineTextKey: null,
    };
  }
  const primary: AxisLetter = score >= TBTI_CL_BOUNDARY_PCT ? 'C' : 'L';
  const primaryPct = primary === 'C' ? score : 100 - score;
  const secondary: AxisLetter = primary === 'C' ? 'L' : 'C';
  const secondaryPct = 100 - primaryPct;
  const chips: TbtiAxis['chips'] = [];
  if (isSimilar(primaryPct, secondaryPct)) {
    chips.push('similar');
  }
  let baselineKey: string | null = TBTI_BASELINE_IMC2016_KEY;
  let baselineTextKey: string | null = TBTI_BASELINE_IMC2016_TEXT_KEY;
  let caveats: Caveat[];
  let reflected: { got: number; of: number } | undefined;
  if (got === 0) {
    // 업적 미반영이면 baseline 생략(R15-3).
    chips.push('ach_not_reflected');
    baselineKey = null;
    baselineTextKey = null;
    caveats = [
      { code: 'hidden_excluded', count: hiddenExcluded },
      { code: 'ach_not_reflected', count: null },
    ];
  } else if (!useAch || got < of) {
    // 부분 반영(ach_partial)도 baseline 표시(R15-3). ready 2편 미만(F-39)도 2재료 + ach_partial.
    chips.push('ach_partial');
    reflected = achReflected;
    caveats = [
      { code: 'hidden_excluded', count: hiddenExcluded },
      { code: 'ach_partial', count: got },
    ];
  } else {
    caveats = [{ code: 'hidden_excluded', count: hiddenExcluded }];
  }
  return {
    ...base,
    primary,
    primaryPct,
    secondary,
    secondaryPct,
    chips,
    ...(reflected !== undefined ? { achReflected: reflected } : {}),
    held: false,
    heldReasonKey: null,
    caveats,
    baselineKey,
    baselineTextKey,
  };
}

/**
 * gameLetters 귀속(PM 확정 — ③④는 귀속 규칙 미정이라 null, 지어내지 않는다).
 * - ① 게임 태그 편: I만→I · R만→R · 둘 다→축 우세편(보류면 ?) · 판정 제외(tagStatus 미ready·사전 빗나감)→?
 * - ② 게임 버킷: confirmed→N · late/no_evidence→H(N 아님=H 준용) · 출시일 미확인→?
 * - ③④: null.
 * 대상 = 4축 evidence 합집합(근거 행 게임별), 정렬 = key 오름차순(결정성).
 */
function buildGameLetters(
  visible: GameFacts[],
  axes: [TbtiAxis, TbtiAxis, TbtiAxis, TbtiAxis],
  classes: Map<string, NhClass>,
): TbtiResult['gameLetters'] {
  const keySet = new Map<string, GameKey>();
  for (const axis of axes) {
    for (const row of axis.evidence) {
      keySet.set(itemKeyOf(row.key), row.key);
    }
  }
  const byKey = new Map<string, GameFacts>();
  for (const game of visible) {
    byKey.set(gameKeyOf(game), game);
  }
  const axis1Primary = axes[0].primary;
  const rows: TbtiResult['gameLetters'] = [];
  for (const [id, key] of [...keySet.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  )) {
    const game = byKey.get(id);
    if (game === undefined) continue;
    let first: AxisLetter = '?';
    if (game.tagStatus === 'ready') {
      const side = tagSide(game);
      if (side === 'I') first = 'I';
      else if (side === 'R') first = 'R';
      else if (side === 'both') {
        first = axis1Primary === 'I' || axis1Primary === 'R' ? axis1Primary : '?';
      }
    }
    let second: AxisLetter = '?';
    if (game.releaseDate !== null) {
      const cls = classes.get(id);
      if (cls !== undefined) {
        second = cls.bucket === 'confirmed' ? 'N' : 'H';
      }
    }
    rows.push({ key, letters: [first, second, null, null] });
  }
  return rows;
}

/**
 * TBTI 판정 본체 (계약 R15-5·R15-4).
 * T3 소비: judgeSeriesBundles({ games, seriesAliases }) 1회.
 * H 분자 = size≥2 묶음 귀속 게임 시간 합. items key→bundleId 매핑 사용.
 */
export function judgeTbti(input: TbtiJudgeInput): TbtiResult {
  const { games, wishlistEnabled, now, seriesAliases, ownedObservedDays } = input;
  const hiddenExcluded = games.filter((game) => game.hidden).length;
  const visible = games.filter((game) => !game.hidden);
  const totalMinutes = visible.reduce((sum, game) => sum + game.confirmedMinutes, 0);

  const series = judgeSeriesBundles({ games, seriesAliases });
  const hBundleIds = new Set(
    series.bundles.filter((bundle) => bundle.size >= 2).map((bundle) => bundle.bundleId),
  );
  const hKeys = new Set(
    series.items
      .filter((item) => hBundleIds.has(item.bundleId))
      .map((item) => itemKeyOf(item.key)),
  );
  const visibleByKey = new Map<string, GameFacts>();
  for (const game of visible) {
    visibleByKey.set(gameKeyOf(game), game);
  }
  const hMinutes = visible
    .filter((game) => hKeys.has(gameKeyOf(game)))
    .reduce((sum, game) => sum + game.confirmedMinutes, 0);
  // metrics ② bundles(확정 M1): size≥2 묶음만, 시간 내림차순·동률 bundleId 오름차순 상위 3.
  // games = 숨김 제외 귀속 게임 수 · minutes = confirmedMinutes 합(분, 원값).
  const bundlesTop3: NhBundleStat[] = series.bundles
    .filter((bundle) => bundle.size >= 2)
    .map((bundle) => {
      let bundleGames = 0;
      let bundleMinutes = 0;
      let representativeKey: GameKey | null = null;
      let representativeMinutes = -1;
      // H 분자와 같은 소스(bundle.keys → visible) 사용.
      // 대표 = 묶음 안 confirmedMinutes 최대 게임, 동률 key 오름차순.
      for (const key of bundle.keys) {
        const game = visibleByKey.get(itemKeyOf(key));
        if (game !== undefined) {
          bundleGames += 1;
          bundleMinutes += game.confirmedMinutes;
          if (
            representativeKey === null ||
            game.confirmedMinutes > representativeMinutes ||
            (game.confirmedMinutes === representativeMinutes &&
              compareGameKey(game.key, representativeKey) < 0)
          ) {
            representativeKey = game.key;
            representativeMinutes = game.confirmedMinutes;
          }
        }
      }
      // 귀속 visible 0건이면 결정성 fallback: bundle.keys 중 key 오름차순 첫째.
      if (representativeKey === null) {
        representativeKey = [...bundle.keys].sort(compareGameKey)[0] as GameKey;
      }
      return { id: bundle.bundleId, games: bundleGames, minutes: bundleMinutes, representativeKey };
    })
    .sort((a, b) => b.minutes - a.minutes || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 3);

  const classes = classifyAllNh(visible, wishlistEnabled);
  const axes: [TbtiAxis, TbtiAxis, TbtiAxis, TbtiAxis] = [
    judgeAxis1(visible, hiddenExcluded),
    judgeAxis2(visible, hiddenExcluded, totalMinutes, wishlistEnabled, hMinutes, series.aliasBundleCount, bundlesTop3),
    judgeAxis3(visible, hiddenExcluded),
    judgeAxis4(visible, hiddenExcluded, now),
  ];
  const gameLetters = buildGameLetters(visible, axes, classes);

  // 전체 보류: 숨김 제외 confirmedMinutes 합 < 300분(R22 확정).
  if (totalMinutes < TBTI_PENDING_NEED_MINUTES) {
    const toPendingAxis = (axis: TbtiAxis): TbtiAxis => ({
      ...axis,
      primary: '?',
      primaryPct: null,
      secondary: null,
      secondaryPct: null,
      nInterval: null,
      chips: [],
      held: true,
      heldReasonKey: axis.heldReasonKey ?? 'short_sample',
    });
    const pendingAxes: [TbtiAxis, TbtiAxis, TbtiAxis, TbtiAxis] = [
      toPendingAxis(axes[0]),
      toPendingAxis(axes[1]),
      toPendingAxis(axes[2]),
      toPendingAxis(axes[3]),
    ];
    return {
      code: '????',
      axes: pendingAxes,
      pending: true,
      pendingHours: { have: totalMinutes, need: TBTI_PENDING_NEED_MINUTES },
      caveats: resultCaveats(hiddenExcluded, ownedObservedDays),
      gameLetters,
      aliasStatus: seriesAliases.status,
    };
  }

  return {
    code: axes.map((axis) => axis.primary).join(''),
    axes,
    pending: false,
    // 비보류면 pendingHours null(R22).
    pendingHours: null,
    caveats: resultCaveats(hiddenExcluded, ownedObservedDays),
    gameLetters,
    aliasStatus: seriesAliases.status,
  };
}

/**
 * TbtiResult.caveats 구성(R20 + 계약 v1.0.2 델타, PM 결정 #109684).
 * 공통 4종(observation_days·hidden_excluded·outside_steam_missing·server_record_basis).
 * observation_days count = ownedObservedDays.length
 * (RecapInput.ownedObservedDays와 동일 출처·의미 — owned 소스 ok run의 observedDay distinct.
 * 스냅샷 distinct 계산은 제거).
 * 섹션(01~06) 코드 합성은 리캡 조립(T1) 몫이라 여기서는 싣지 않는다.
 */
function resultCaveats(hiddenExcluded: number, ownedObservedDays: string[]): Caveat[] {
  return [
    { code: 'observation_days', count: ownedObservedDays.length },
    { code: 'hidden_excluded', count: hiddenExcluded },
    { code: 'outside_steam_missing', count: null },
    { code: 'server_record_basis', count: null },
  ];
}
