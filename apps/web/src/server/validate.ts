/**
 * W2 body 검증 헬퍼 — 라우트 핸들러가 JSON 본문을 읽고 호출자 가드로 검사한다.
 * 실패: 400 + {code: 'INVALID_BODY', params} (PM #61255 Q1·Q4).
 * zod 미사용(Q5)이라 가드는 호출자가 직접 적는다. 적용 라우트는 W5 이후에서 붙인다.
 */
import type { Context } from 'hono';
import type { RequestDeniedBody } from './request-errors.js';

export type BodyGuard<T> = (
  unknownBody: unknown,
) => { ok: true; value: T } | { ok: false; params: Record<string, string | number> };

/** 본문 읽기 + 가드. 가드 실패·JSON 파싱 실패 모두 400으로 답한다. */
export async function parseJsonBody<T>(
  c: Context,
  guard: BodyGuard<T>,
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: denied({}) };
  }
  const checked = guard(raw);
  if (!checked.ok) {
    return { ok: false, response: denied(checked.params) };
  }
  return { ok: true, value: checked.value };
}

function denied(params: Record<string, string | number>): Response {
  const body: RequestDeniedBody = { code: 'INVALID_BODY', params };
  return Response.json(body, { status: 400 });
}
