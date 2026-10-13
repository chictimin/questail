import Database from 'better-sqlite3';
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

  // R15-9 S1 등록 — library는 200, 월간은 R2까지 404 유지.
  it('R1.5 등록 — GET /api/recap/library → 200', async () => {
    const db = new Database(':memory:');
    try {
      const response = await createServerApp({
        staticRoot: FIXTURE,
        exportDeps: { db, exportDir: FIXTURE },
      }).request('/api/recap/library', { headers: HOST });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      for (const key of ['basis', 's01', 's02', 's03', 's04', 's05', 's06', 'tbti']) {
        expect(body).toHaveProperty(key);
      }
    } finally {
      db.close();
    }
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
