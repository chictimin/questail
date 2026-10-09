/**
 * W2 Hono 앱 팩토리 — 라우트 등록만 한다. listen은 serve.ts가 맡는다(기동 순서 본체는 W3).
 * Host/Origin 검사는 middleware/host.ts가 맡고, 합성은 createServerApp(묶음 ③)이 한다.
 * W9: POST /api/export — exportDeps(db·exportDir) 주입 시에만 동작, 없으면 500.
 */
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { createLogger } from './logging.js';
import { readExportGames } from '../data/export.js';
import { listLibrary } from '../data/library.js';
import { setRating, type ScoreValue } from '../data/ratings.js';
import { getAchievementSettings, getPrefs, setAchievementSettings, setPrefs } from '../data/viewState.js';
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
import { registerConnectRoutes, type ConnectDeps } from './routes/connect.js';
import {
  registerSettingsInfoRoutes,
  type SettingsDeps,
} from './routes/settings-info.js';
import { parseJsonBody, type BodyGuard } from './validate.js';

export const HEALTH_PATH = '/api/health';
export const EXPORT_PATH = '/api/export';
export const LIBRARY_PATH = '/api/library';
export const PREFS_PATH = '/api/prefs';
export const ACHIEVEMENTS_PATH = '/api/settings/achievements';

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

type RatingRequest = { score: ScoreValue | null };function isScoreValue(value: unknown): value is ScoreValue {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10
  );
}

const ratingBodyGuard: BodyGuard<RatingRequest> = (unknownBody) => {
  if (typeof unknownBody !== 'object' || unknownBody === null) {
    return { ok: false, params: { reason: 'score' } };
  }
  const score = (unknownBody as { score?: unknown }).score;
  if (score !== null && !isScoreValue(score)) {
    return { ok: false, params: { reason: 'score' } };
  }
  return { ok: true, value: { score } };
};

type PrefsPatch = {
  locale?: Locale;
  hidden?: { platform: string; externalId: string }[];
  sortPerFilter?: { filterKey: string; sortKey: string; direction: 'asc' | 'desc' }[];
};

function isGameKey(value: unknown): value is { platform: string; externalId: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { platform?: unknown }).platform === 'string' &&
    typeof (value as { externalId?: unknown }).externalId === 'string'
  );
}

function isSortEntry(value: unknown): value is NonNullable<PrefsPatch['sortPerFilter']>[number] {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { filterKey?: unknown }).filterKey === 'string' &&
    typeof (value as { sortKey?: unknown }).sortKey === 'string' &&
    ((value as { direction?: unknown }).direction === 'asc' ||
      (value as { direction?: unknown }).direction === 'desc')
  );
}

const prefsBodyGuard: BodyGuard<PrefsPatch> = (unknownBody) => {
  if (typeof unknownBody !== 'object' || unknownBody === null) {
    return { ok: false, params: { reason: 'prefs' } };
  }
  const body = unknownBody as Record<string, unknown>;
  if (body['locale'] !== undefined && body['locale'] !== 'ko' && body['locale'] !== 'en') {
    return { ok: false, params: { reason: 'locale' } };
  }
  if (
    body['hidden'] !== undefined &&
    (!Array.isArray(body['hidden']) || !body['hidden'].every(isGameKey))
  ) {
    return { ok: false, params: { reason: 'hidden' } };
  }
  if (
    body['sortPerFilter'] !== undefined &&
    (!Array.isArray(body['sortPerFilter']) || !body['sortPerFilter'].every(isSortEntry))
  ) {
    return { ok: false, params: { reason: 'sortPerFilter' } };
  }
  return {
    ok: true,
    value: {
      ...(body['locale'] === undefined
        ? {}
        : { locale: body['locale'] as Locale }),
      ...(body['hidden'] === undefined
        ? {}
        : { hidden: body['hidden'] as PrefsPatch['hidden'] }),
      ...(body['sortPerFilter'] === undefined
        ? {}
        : { sortPerFilter: body['sortPerFilter'] as PrefsPatch['sortPerFilter'] }),
    },
  };
};

type AchievementsRequest = { enabled: boolean };

const achievementsBodyGuard: BodyGuard<AchievementsRequest> = (unknownBody) => {
  if (typeof unknownBody !== 'object' || unknownBody === null) {
    return { ok: false, params: { reason: 'achievements' } };
  }
  const enabled = (unknownBody as { enabled?: unknown }).enabled;
  if (typeof enabled !== 'boolean') {
    return { ok: false, params: { reason: 'enabled' } };
  }
  return { ok: true, value: { enabled } };
};

/** ?fallback=ko|en 필수 query (P-1). 없거나 잘못되면 null이다. */
function parseFallback(c: Context): Locale | null {
  const raw = c.req.query('fallback');
  return raw === 'ko' || raw === 'en' ? raw : null;
}

function invalidBody(c: Context, reason: string): Response {
  const body: RequestDeniedBody = { code: 'INVALID_BODY', params: { reason } };
  return c.json(body, 400);
}

function internalError(c: Context): Response {
  const body: RequestDeniedBody = { code: 'INTERNAL', params: {} };
  return c.json(body, 500);
}

/** better-sqlite3 FK 위반 — 게임 행 없는 키로의 쓰기다(Q1). */
function isForeignKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
  );
}

/** bare 앱 — 라우트만. 테스트·합성의 재료다. */
export function createApp(
  exportDeps?: ExportDeps,
  connectDeps?: ConnectDeps,
  settingsDeps?: SettingsDeps,
): Hono {
  const app = new Hono();
  registerRoutes(app, exportDeps, connectDeps, settingsDeps);
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
  connectDeps?: ConnectDeps;
  settingsDeps?: SettingsDeps;
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
  registerRoutes(app, opts?.exportDeps, opts?.connectDeps, opts?.settingsDeps);
  if (opts?.staticRoot !== undefined) {
    wireStatic(app, opts.staticRoot);
  }
  return app;
}

function registerRoutes(
  app: Hono,
  exportDeps?: ExportDeps,
  connectDeps?: ConnectDeps,
  settingsDeps?: SettingsDeps,
): void {
  app.get(HEALTH_PATH, (c) => c.json({ status: 'ok' }));
  registerConnectRoutes(app, connectDeps);
  registerSettingsInfoRoutes(app, settingsDeps);
  app.get(LIBRARY_PATH, (c) => {
    if (exportDeps === undefined) {
      return internalError(c);
    }
    const raw = c.req.query('includeEnded');
    if (raw !== undefined && raw !== 'true' && raw !== 'false') {
      return invalidBody(c, 'includeEnded');
    }
    return c.json(
      listLibrary(exportDeps.db, { includeEnded: raw === 'true' }),
    );
  });
  app.put('/api/ratings/:platform/:externalId', async (c) => {
    const parsed = await parseJsonBody(c, ratingBodyGuard);
    if (!parsed.ok) {
      return parsed.response;
    }
    if (exportDeps === undefined) {
      return internalError(c);
    }
    try {
      return c.json(
        setRating(
          exportDeps.db,
          {
            platform: c.req.param('platform'),
            externalId: c.req.param('externalId'),
          },
          parsed.value.score,
        ),
      );
    } catch (error) {
      // 게임 행 없는 키 — B는 존재를 따로 조회하지 않고 FK 실패로 판정한다(Q1).
      if (isForeignKeyError(error)) {
        const body: RequestDeniedBody = { code: 'GAME_NOT_FOUND', params: {} };
        return c.json(body, 404);
      }
      throw error;
    }
  });
  app.get(PREFS_PATH, (c) => {
    const fallback = parseFallback(c);
    if (fallback === null) {
      return invalidBody(c, 'fallback');
    }
    if (exportDeps === undefined) {
      return internalError(c);
    }
    return c.json(getPrefs(exportDeps.db, fallback));
  });
  app.put(PREFS_PATH, async (c) => {
    const fallback = parseFallback(c);
    if (fallback === null) {
      return invalidBody(c, 'fallback');
    }
    const parsed = await parseJsonBody(c, prefsBodyGuard);
    if (!parsed.ok) {
      return parsed.response;
    }
    if (exportDeps === undefined) {
      return internalError(c);
    }
    setPrefs(exportDeps.db, parsed.value);
    return c.json(getPrefs(exportDeps.db, fallback));
  });
  app.get(ACHIEVEMENTS_PATH, (c) => {
    if (exportDeps === undefined) {
      return internalError(c);
    }
    return c.json(getAchievementSettings(exportDeps.db));
  });
  app.put(ACHIEVEMENTS_PATH, async (c) => {
    const parsed = await parseJsonBody(c, achievementsBodyGuard);
    if (!parsed.ok) {
      return parsed.response;
    }
    if (exportDeps === undefined) {
      return internalError(c);
    }
    setAchievementSettings(exportDeps.db, parsed.value);
    return c.json(getAchievementSettings(exportDeps.db));
  });
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
