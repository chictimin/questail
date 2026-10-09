/** U5-[1] W-S1 GET /api/settings/info — 형태·버전·키 경로 미포함. */
import { describe, expect, it } from 'vitest';
import { KEY_FILE_NAME } from '../../src/data/index.js';
import { createApp } from '../../src/server/app.js';
import { SETTINGS_INFO_PATH } from '../../src/server/routes/settings-info.js';

describe('GET /api/settings/info', () => {
  it('deps 없음 → 500 INTERNAL', async () => {
    const response = await createApp().request(SETTINGS_INFO_PATH);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'INTERNAL', params: {} });
  });

  it('{dataDir, version} + 키 경로 미포함', async () => {
    const app = createApp(undefined, undefined, {
      dataDir: '/tmp/questail-data',
      version: '0.1.0-test',
    });
    const response = await app.request(SETTINGS_INFO_PATH);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ dataDir: '/tmp/questail-data', version: '0.1.0-test' });
    expect(JSON.stringify(body)).not.toContain(KEY_FILE_NAME);
  });
});
