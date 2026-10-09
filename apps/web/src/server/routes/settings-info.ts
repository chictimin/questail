/**
 * U5-[1] W-S1 설정 정보 API — dataDir 표시 경로 + 버전.
 * 키 경로·키 파일명은 반환 0(반향 규칙). 버전은 boot 1회 읽기(ctx.version).
 */
import type { Context, Hono } from 'hono';
import type { RequestDeniedBody } from '../request-errors.js';

export const SETTINGS_INFO_PATH = '/api/settings/info';

export interface SettingsDeps {
  dataDir: string;
  version: string;
}

export function settingsInternalError(c: Context): Response {
  const body: RequestDeniedBody = { code: 'INTERNAL', params: {} };
  return c.json(body, 500);
}

export function registerSettingsInfoRoutes(app: Hono, deps?: SettingsDeps): void {
  app.get(SETTINGS_INFO_PATH, (c) => {
    if (deps === undefined) {
      return settingsInternalError(c);
    }
    return c.json({ dataDir: deps.dataDir, version: deps.version });
  });
}
