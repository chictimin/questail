/**
 * W14 hc 클라이언트 — 동일 오리진 상대경로. 지금은 타입 export와 생성만(호출 없음).
 */
import { hc } from 'hono/client';
import type { AppType } from '../server/app.js';

export type ApiClient = ReturnType<typeof hc<AppType>>;
export const api: ApiClient = hc<AppType>('/');
