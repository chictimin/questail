import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServerApp } from '../../src/server/app.js';

const FIXTURE = join(
  fileURLToPath(import.meta.url),
  '..',
  '..',
  'static-fixture',
);
const HOST = { host: '127.0.0.1:4747' };

describe('wireStatic', () => {
  it('dist 루트 실재 파일 → 200', async () => {
    const response = await createServerApp({ staticRoot: FIXTURE }).request(
      '/root-file.txt',
      { headers: HOST },
    );
    expect(response.status).toBe(200);
    expect((await response.text()).trim()).toBe('fixture-root-file');
  });

  it('없는 경로 → SPA fallback index.html', async () => {
    const response = await createServerApp({ staticRoot: FIXTURE }).request(
      '/library',
      { headers: HOST },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('fallback');
  });

  it('/api/* 미지 경로 → 404 유지', async () => {
    const response = await createServerApp({ staticRoot: FIXTURE }).request(
      '/api/nope',
      { headers: HOST },
    );
    expect(response.status).toBe(404);
  });
});
