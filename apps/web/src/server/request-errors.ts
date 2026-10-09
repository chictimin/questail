/**
 * W2 요청 거부 코드 — SyncErrorCode와 별도 열거 (PM #61255 Q1).
 * 거부 본문은 {code, params} (Q1), HTTP 상태는 용도별(Host/Origin 403·body 400).
 */
export type RequestErrorCode =
  | 'INVALID_HOST'
  | 'INVALID_ORIGIN'
  | 'INVALID_BODY';

export type RequestDeniedBody = {
  code: RequestErrorCode;
  params: Record<string, string | number>;
};
