/**
 * W2 Hono 앱 팩토리 — 라우트 등록만 한다. listen은 serve.ts가 맡는다(기동 순서 본체는 W3).
 * Host/Origin 검사는 middleware/host.ts가 맡고, 합성은 createServerApp(묶음 ③)이 한다.
 * W9: POST /api/export — exportDeps(db·exportDir) 주입 시에만 동작, 없으면 500.
 */
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { createLogger } from './logging.js';
import { readExportGames } from '../data/export.js';
import type { Locale } from '../ui/i18n/index.js';
import { hostCheck } from './middleware/host.js';
import type { RequestDeniedBody } from './request-errors.js';
import {
  ExportWriteError,
  renderExportFiles,
  writeExportFiles,
  type ExportFailureReason,
} from './export.js';
import { wireStatic } from './static.js';
import { parseJsonBody, type BodyGuard } from './validate.js';

export const HEALTH_PATH = '/api/health';
export const EXPORT_PATH = '/api/export';

/** 내보내기 의존 — boot가 마이그레이션 후 가진 핸들과 데이터 디렉터리에서 준다. */
export type ExportDeps = {
  db: Database.Database;
  exportDir: string;
};

/**
 * 내보내기 실패 응답 — W4 INTERNAL(params {})과 구분된다.
 * 예상 밖 예외는 여기서 잡지 않고 onError(INTERNAL, params {})에 맡긴다.
 * reason은 실제 4종으로 고정한다.
 */
type ExportFailReason = ExportFailureReason | 'not_configured';
type ExportDeniedBody = RequestDeniedBody & {
  code: 'EXPORT_FAILED';
  params: { reason: ExportFailReason };
};

type ExportRequest = { locale: Locale };

const exportBodyGuard: BodyGuard<ExportRequest> = (unknownBody) => {
  if (typeof unknownBody !== 'object' || unknownBody === null) {
    return { ok: false, params: { reason: 'locale' } };
  }
  const locale = (unknownBody as { locale?: unknown }).locale;
  if (locale !== 'ko' && locale !== 'en') {
    return { ok: false, params: { reason: 'locale' } };
  }
  return { ok: true, value: { locale } };
};

/** bare 앱 — 라우트만. 테스트·합성의 재료다. */
export function createApp(exportDeps?: ExportDeps): Hono {
  const app = new Hono();
  registerRoutes(app, exportDeps);
  return app;
}

/** hc 클라이언트용 앱 타입 (W2) */
export type AppType = ReturnType<typeof createApp>;

/**
 * 실서빙 합성 — Host/Origin 검사를 라우트보다 먼저 장착한다.
 * (Hono는 등록 순서대로 실행이라 use()가 get()보다 뒤면 검사가 빠진다.)
 * staticRoot가 있으면 정적 서빙+fallback까지 장착한다(없으면 API만).
 */
export function createServerApp(opts?: {
  staticRoot?: string;
  exportDeps?: ExportDeps;
}): Hono {
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
  registerRoutes(app, opts?.exportDeps);
  if (opts?.staticRoot !== undefined) {
    wireStatic(app, opts.staticRoot);
  }
  return app;
}

function registerRoutes(app: Hono, exportDeps?: ExportDeps): void {
  app.get(HEALTH_PATH, (c) => c.json({ status: 'ok' }));
  app.post(EXPORT_PATH, async (c) => {
    const parsed = await parseJsonBody(c, exportBodyGuard);
    if (!parsed.ok) {
      return parsed.response;
    }
    if (exportDeps === undefined) {
      const body: ExportDeniedBody = {
        code: 'EXPORT_FAILED',
        params: { reason: 'not_configured' },
      };
      return c.json(body, 500);
    }
    try {
      const files = renderExportFiles(
        readExportGames(exportDeps.db),
        parsed.value.locale,
      );
      const { written } = writeExportFiles(exportDeps.exportDir, files);
      return c.json({ written, dir: exportDeps.exportDir });
    } catch (error) {
      if (!(error instanceof ExportWriteError)) {
        throw error;
      }
      const body: ExportDeniedBody = {
        code: 'EXPORT_FAILED',
        params: { reason: error.reason },
      };
      return c.json(body, 500);
    }
  });
}
