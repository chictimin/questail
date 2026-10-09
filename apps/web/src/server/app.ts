/**
 * W2 Hono 앱 팩토리 — 라우트 등록만 한다. listen은 serve.ts가 맡는다(기동 순서 본체는 W3).
 * Host/Origin 검사는 middleware/host.ts가 맡고, 합성은 createServerApp(묶음 ③)이 한다.
 */
import { Hono } from 'hono';
import { createLogger } from './logging.js';
import { hostCheck } from './middleware/host.js';
import type { RequestDeniedBody } from './request-errors.js';
import { wireStatic } from './static.js';

export const HEALTH_PATH = '/api/health';

/** bare 앱 — health 라우트만. 테스트·합성의 재료다. */
export function createApp(): Hono {
  const app = new Hono();
  registerRoutes(app);
  return app;
}

/** hc 클라이언트용 앱 타입 (W2) */
export type AppType = ReturnType<typeof createApp>;

/**
 * 실서빙 합성 — Host/Origin 검사를 라우트보다 먼저 장착한다.
 * (Hono는 등록 순서대로 실행이라 use()가 get()보다 뒤면 검사가 빠진다.)
 * staticRoot가 있으면 정적 서빙+fallback까지 장착한다(없으면 API만).
 */
export function createServerApp(opts?: { staticRoot?: string }): Hono {
  const app = new Hono();
  app.use(hostCheck);
  // W4 — 500 본문은 {code:"INTERNAL",params:{}} 고정. 원문·키 미반향.
  // 로그는 scrub 후 console 경유(stderr 직접 쓰기 없음).
  app.onError((error, c) => {
    createLogger().error(
      `[web] unhandled: ${error instanceof Error ? error.message : String(error)}`,
    );
    const body: RequestDeniedBody = { code: 'INTERNAL', params: {} };
    return c.json(body, 500);
  });
  registerRoutes(app);
  if (opts?.staticRoot !== undefined) {
    wireStatic(app, opts.staticRoot);
  }
  return app;
}

function registerRoutes(app: Hono): void {
  app.get(HEALTH_PATH, (c) => c.json({ status: 'ok' }));
}
