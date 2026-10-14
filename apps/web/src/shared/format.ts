/**
 * R1.5 표시 수치 포맷 — 화면·aria·서버 텍스트 렌더가 함께 쓴다(캡틴 결정 C15-5, 2026-10-14).
 * - 모든 표시 수치는 정수 반올림, 소수점 0.
 * - 별점만 예외: 개별 별점은 0.5 단위 원값 그대로, 평균·편차는 0.5 단위 반올림(Math.round(x*2)/2).
 *   별점 표기는 정수면 소수 없이(★3, +2), 반 별만 .5(★3.5, −2.5) — PM 지시(캡틴 예시 "★2.9 → ★3").
 * - 적용 범위: R1.5 화면 + R1 라이브러리·설정 화면 전부(캡틴 결정, 2026-10-14).
 * - 판정은 core 원값으로 하고, 여기서는 표시만 바꾼다.
 * 천 단위 쉼표는 로케일 ICU와 무관하게 결정적으로 찍는다(ko·en 모두 쉼표) —
 * 서버 텍스트와 브라우저 화면이 같은 문자열을 내야 한다.
 * node·DOM import 0(shared/genres.ts 선례).
 */

/** 정수 반올림 + 천 단위 쉼표. -0은 0으로 찍는다. */
export function formatInt(value: number): string {
  const rounded = Math.round(value);
  const text = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return rounded < 0 ? `-${text}` : text;
}

/** 퍼센트 숫자(기호 없음) — 0~100 실수 → 정수. */
export function formatPct(value: number): string {
  return formatInt(value);
}

/** 비율(0~1) → 퍼센트 숫자(기호 없음). */
export function formatRatioPct(ratio: number): string {
  return formatInt(ratio * 100);
}

/** 분 → 시간 정수. */
export function formatHours(minutes: number): string {
  return formatInt(minutes / 60);
}

/** 0.5 단위 값 표기 — 정수면 소수 없이, 반이면 .5. */
function halfText(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** 개별 별점 — 0.5 단위 원값 그대로(정수면 소수 없이). */
export function formatStar(score: number): string {
  return halfText(score);
}

/** 별점 평균 — 0.5 단위 반올림. */
export function formatStarAvg(mean: number): string {
  return halfText(Math.round(mean * 2) / 2);
}

/**
 * 별점 편차 — 절댓값을 0.5 단위 반올림한 뒤 부호(+ / −)를 붙인다.
 * 절댓값 기준이라 +2.25·−2.25가 같은 크기(2.5)로 찍힌다(Math.round의 양수 쪽 치우침 회피).
 */
export function formatStarDev(dev: number): string {
  const abs = Math.round(Math.abs(dev) * 2) / 2;
  const sign = dev < 0 && abs > 0 ? '−' : '+';
  return `${sign}${halfText(abs)}`;
}

/**
 * caveat 개수 — `n_covered_ratio`만 비율(%)이고 나머지는 개수다(계약 R15-4).
 * 비율 값은 0~100 실수로 오므로 정수 + '%'로 찍는다.
 */
export function formatCaveatCount(code: string, count: number): string {
  return code === 'n_covered_ratio' ? `${formatPct(count)}%` : formatInt(count);
}

/**
 * 보류 진행 시간(`{have} / 5시간`) — 정수지만 반올림이 아니라 내림이다:
 * 4.6시간을 "5 / 5시간"으로 찍으면 아직 보류인데 다 찬 것처럼 읽힌다.
 */
export function formatPendingHours(minutes: number): string {
  return formatInt(Math.floor(minutes / 60));
}
