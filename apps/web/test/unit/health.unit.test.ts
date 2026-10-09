import { describe, expect, it } from 'vitest';
import { HEALTH_PATH, createApp } from '../../src/server/app.js';
import { resolvePort } from '../../src/server/serve.js';

describe('GET /api/health (app.request)', () => {
  it('→ 200 { status: ok }', async () => {
    const response = await createApp().request(HEALTH_PATH);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('unknown path → 404', async () => {
    const response = await createApp().request('/api/nope');
    expect(response.status).toBe(404);
  });
});

describe('resolvePort', () => {
  it('미지정 → 4747', () => {
    expect(resolvePort({})).toBe(4747);
  });

  it('QUESTAIL_PORT 숫자 → 그대로', () => {
    expect(resolvePort({ QUESTAIL_PORT: '5000' })).toBe(5000);
  });

  it('비숫자·범위 밖 → throw', () => {
    expect(() => resolvePort({ QUESTAIL_PORT: 'abc' })).toThrow();
    expect(() => resolvePort({ QUESTAIL_PORT: '0' })).toThrow();
    expect(() => resolvePort({ QUESTAIL_PORT: '65536' })).toThrow();
  });
});
