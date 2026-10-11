/**
 * R1 이름 예약(계약 276). 라우트 미등록 — hc 타입 노출은 R1.5(전체)/R2(월간) 등록 시점.
 * 등록 때 이 상수를 단일 출처로 쓴다.
 */
export const RECAP_RESERVED_PATHS = {
  library: '/api/recap/library',
  monthly: '/api/recap/monthly/:yyyy-mm',
} as const;
