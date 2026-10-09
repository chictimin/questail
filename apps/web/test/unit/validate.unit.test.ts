import { describe, expect, it } from 'vitest';
import { createServerApp } from '../../src/server/app.js';
import { parseJsonBody, type BodyGuard } from '../../src/server/validate.js';

const isPair: BodyGuard<{ a: string }> = (raw: unknown) =>
  typeof raw === 'object' &&
  raw !== null &&
  'a' in raw &&
  typeof (raw as { a: unknown }).a === 'string'
    ? { ok: true, value: { a: (raw as { a: string }).a } }
    : { ok: false, params: { field: 'a' } };

// parseJsonBody는 Context를 받으므로 합성 앱에 임시 POST 라우트를 얹어 검증한다.
function appWithEcho() {
  const app = createServerApp();
  app.post('/echo', async (c) => {
    const parsed = await parseJsonBody(c, isPair);
    if (!parsed.ok) {
      return parsed.response;
    }
    return c.json(parsed.value);
  });
  return app;
}

describe('parseJsonBody', () => {
  it('가드 통과 → 값', async () => {
    const response = await appWithEcho().request('/echo', {
      method: 'POST',
      headers: { host: '127.0.0.1:4747', 'content-type': 'application/json' },
      body: JSON.stringify({ a: 'x' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ a: 'x' });
  });

  it('가드 실패 → 400 {code: INVALID_BODY}', async () => {
    const response = await appWithEcho().request('/echo', {
      method: 'POST',
      headers: { host: '127.0.0.1:4747', 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 'INVALID_BODY',
      params: { field: 'a' },
    });
  });

  it('JSON 파싱 실패 → 400 {code: INVALID_BODY}', async () => {
    const response = await appWithEcho().request('/echo', {
      method: 'POST',
      headers: { host: '127.0.0.1:4747', 'content-type': 'application/json' },
      body: '{깨짐',
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe(
      'INVALID_BODY',
    );
  });
});
