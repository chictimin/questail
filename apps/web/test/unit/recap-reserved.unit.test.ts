import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServerApp } from '../../src/server/app.js';
import { RECAP_RESERVED_PATHS } from '../../src/server/recapReserved.js';

const FIXTURE = join(
  fileURLToPath(import.meta.url),
  '..',
  '..',
  'static-fixture',
);
const HOST = { host: '127.0.0.1:4747' };

describe('recap 예약 경로', () => {
  it('상수값이 계약 276행 원문과 같다', () => {
    expect(RECAP_RESERVED_PATHS).toEqual({
      library: '/api/recap/library',
      monthly: '/api/recap/monthly/:yyyy-mm',
    });
  });

  // R1 미등록 — R1.5 전체 recap / R2 월간 recap 착수 시 이 기대를 교체(의도된 실패 신호).
  it('R1 미등록 — GET /api/recap/library → 404 not_found (R1.5 착수 시 교체)', async () => {
    const response = await createServerApp({ staticRoot: FIXTURE }).request(
      '/api/recap/library',
      { headers: HOST },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ status: 'not_found' });
  });

  it('R1 미등록 — GET /api/recap/monthly/2026-10 → 404 not_found (R2 착수 시 교체)', async () => {
    const response = await createServerApp({ staticRoot: FIXTURE }).request(
      '/api/recap/monthly/2026-10',
      { headers: HOST },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ status: 'not_found' });
  });
});
