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
import { ALL_SOURCES, type CollectSource } from '../data/sync.js';
import type { SyncService } from '../data/service.js';
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
import type { DataHolder } from './dataHolder.js';
import {
  readPendingPrefs,
  writePendingPrefs,
  type AttachController,
} from './attach.js';
import { parseJsonBody, type BodyGuard } from './validate.js';
// U5-[1] W-S2 — W-S1(info import)과 별도 hunk로 둔다.
import { registerSettingsBackupsRoutes } from './routes/settings-backups.js';

export const HEALTH_PATH = '/api/health';
export const EXPORT_PATH = '/api/export';
export const LIBRARY_PATH = '/api/library';
export const PREFS_PATH = '/api/prefs';
export const ACHIEVEMENTS_PATH = '/api/settings/achievements';
export const SYNC_PATH = '/api/sync';
export const SYNC_STATUS_PATH = '/api/sync/status';

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

type RatingRequest = { score: ScoreValue | null };
type SyncStartRequest = { locale: Locale; sources?: CollectSource[] };
type SyncRetryRequest = { locale: Locale; mode?: 'resume' | 'refresh' };

function isCollectSource(value: unknown): value is CollectSource {
  return (
    typeof value === 'string' &&
    (ALL_SOURCES as readonly string[]).includes(value)
  );
}

const syncStartGuard: BodyGuard<SyncStartRequest> = (unknownBody) => {
  if (typeof unknownBody !== 'object' || unknownBody === null) {
    return { ok: false, params: { reason: 'sync' } };
  }
  const body = unknownBody as Record<string, unknown>;
  if (body['locale'] !== 'ko' && body['locale'] !== 'en') {
    return { ok: false, params: { reason: 'locale' } };
  }
  if (
    body['sources'] !== undefined &&
    (!Array.isArray(body['sources']) ||
      body['sources'].length === 0 ||
      !body['sources'].every(isCollectSource))
  ) {
    return { ok: false, params: { reason: 'sources' } };
  }
  return {
    ok: true,
    value: {
      locale: body['locale'] as Locale,
      ...(body['sources'] === undefined
        ? {}
        : { sources: body['sources'] as CollectSource[] }),
    },
  };
};

const syncRetryGuard: BodyGuard<SyncRetryRequest> = (unknownBody) => {
  if (typeof unknownBody !== 'object' || unknownBody === null) {
    return { ok: false, params: { reason: 'sync' } };
  }
  const body = unknownBody as Record<string, unknown>;
  if (body['locale'] !== 'ko' && body['locale'] !== 'en') {
    return { ok: false, params: { reason: 'locale' } };
  }
  if (
    body['mode'] !== undefined &&
    body['mode'] !== 'resume' &&
    body['mode'] !== 'refresh'
  ) {
    return { ok: false, params: { reason: 'mode' } };
  }
  return {
    ok: true,
    value: {
      locale: body['locale'] as Locale,
      ...(body['mode'] === undefined
        ? {}
        : { mode: body['mode'] as 'resume' | 'refresh' }),
    },
  };
};

function syncResult(
  c: Context,
  result: number | { code: 'SYNC_IN_PROGRESS'; source: CollectSource },
): Response {
  if (typeof result === 'number') {
    return c.json({ runId: result }, 202);
  }
  const body: RequestDeniedBody = {
    code: 'SYNC_IN_PROGRESS',
    params: { source: result.source },
  };
  return c.json(body, 409);
}

function registerSyncRoutes(app: Hono, syncService?: SyncService, holder?: DataHolder): void {
  app.post(SYNC_PATH, async (c) => {
    if (isUnattached(holder)) {
      return notConnected(c);
    }
    const parsed = await parseJsonBody(c, syncStartGuard);
    if (!parsed.ok) {
      return parsed.response;
    }
    // D16-2 — 요청 시작 시 holder 1회 읽기.
    const service = holder?.get()?.syncService ?? syncService;
    if (service === undefined) {
      return internalError(c);
    }
    return syncResult(
      c,
      service.startSync({
        ...(parsed.value.sources === undefined
          ? {}
          : { sources: parsed.value.sources }),
        locale: parsed.value.locale,
      }),
    );
  });
  app.post(`${SYNC_PATH}/:source/retry`, async (c) => {
    if (isUnattached(holder)) {
      return notConnected(c);
    }
    const source = c.req.param('source');
    if (!isCollectSource(source)) {
      return invalidBody(c, 'source');
    }
    const parsed = await parseJsonBody(c, syncRetryGuard);
    if (!parsed.ok) {
      return parsed.response;
    }
    // D16-2 — 요청 시작 시 holder 1회 읽기.
    const service = holder?.get()?.syncService ?? syncService;
    if (service === undefined) {
      return internalError(c);
    }
    return syncResult(
      c,
      service.resyncSource(source, {
        ...(parsed.value.mode === undefined ? {} : { mode: parsed.value.mode }),
        locale: parsed.value.locale,
      }),
    );
  });
  app.get(SYNC_STATUS_PATH, (c) => {
    if (isUnattached(holder)) {
      return notConnected(c);
    }
    // D16-2 — 요청 시작 시 holder 1회 읽기.
    const service = holder?.get()?.syncService ?? syncService;
    if (service === undefined) {
      return internalError(c);
    }
    return c.json(service.getSyncStatus());
  });
}function isScoreValue(value: unknown): value is ScoreValue {
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
  hideShortPlaytime?: boolean;
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
  if (body['hideShortPlaytime'] !== undefined && typeof body['hideShortPlaytime'] !== 'boolean') {
    return { ok: false, params: { reason: 'hideShortPlaytime' } };
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
      ...(body['hideShortPlaytime'] === undefined
        ? {}
        : { hideShortPlaytime: body['hideShortPlaytime'] as boolean }),
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

/** 연동 전(미부착) 데이터 API — 409 NOT_CONNECTED(웹 소유 문구). */
function notConnected(c: Context): Response {
  const body: RequestDeniedBody = { code: 'NOT_CONNECTED', params: {} };
  return c.json(body, 409);
}

/** holder가 있고 아직 계층이 없으면 미부착이다. */
function isUnattached(holder: DataHolder | undefined): boolean {
  return holder !== undefined && holder.get() === undefined;
}

function connectInProgress(c: Context): Response {
  const body: RequestDeniedBody = { code: 'CONNECT_IN_PROGRESS', params: {} };
  return c.json(body, 409);
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
  syncService?: SyncService,
  holder?: DataHolder,
  attach?: AttachController,
): Hono {
  const app = new Hono();
  registerRoutes(app, exportDeps, connectDeps, settingsDeps, syncService, holder, attach);
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
  syncService?: SyncService;
  /** D16-2 holder — 있으면 라우트가 closure 대신 holder에서 읽는다. */
  holder?: DataHolder;
  /** 미부착 기동의 대기 값·connect 잠금·부착 흐름(P-12). */
  attach?: AttachController;
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
  registerRoutes(
    app,
    opts?.exportDeps,
    opts?.connectDeps,
    opts?.settingsDeps,
    opts?.syncService,
    opts?.holder,
    opts?.attach,
  );
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
  syncService?: SyncService,
  holder?: DataHolder,
  attach?: AttachController,
): void {
  app.get(HEALTH_PATH, (c) => c.json({ status: 'ok' }));
  registerConnectRoutes(app, connectDeps, holder, attach);
  registerSettingsInfoRoutes(app, settingsDeps, holder);
  registerSyncRoutes(app, syncService, holder);
  app.get(LIBRARY_PATH, (c) => {
    if (isUnattached(holder)) {
      return notConnected(c);
    }
    // D16-2 — 요청 시작 시 holder 1회 읽기.
    const layer = holder?.get();
    const db = layer?.db ?? exportDeps?.db;
    if (db === undefined) {
      return internalError(c);
    }
    const raw = c.req.query('includeEnded');
    if (raw !== undefined && raw !== 'true' && raw !== 'false') {
      return invalidBody(c, 'includeEnded');
    }
    return c.json(
      listLibrary(db, { includeEnded: raw === 'true' }),
    );
  });
  app.put('/api/ratings/:platform/:externalId', async (c) => {
    if (isUnattached(holder)) {
      return notConnected(c);
    }
    const parsed = await parseJsonBody(c, ratingBodyGuard);
    if (!parsed.ok) {
      return parsed.response;
    }
    // D16-2 — 요청 시작 시 holder 1회 읽기.
    const db = holder?.get()?.db ?? exportDeps?.db;
    if (db === undefined) {
      return internalError(c);
    }
    try {
      return c.json(
        setRating(
          db,
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
    // 요청 시작 시 holder 1회 읽기. 미부착이면 메모리 대기 값 위에 기본값.
    const db = holder?.get()?.db ?? exportDeps?.db;
    if (isUnattached(holder)) {
      if (attach === undefined) {
        return notConnected(c);
      }
      return c.json(readPendingPrefs(attach.pending, fallback));
    }
    if (db === undefined) {
      return internalError(c);
    }
    return c.json(getPrefs(db, fallback));
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
    // 미부착(부착 중 포함)이면 connect 잠금 해제까지 대기(최대 attach.waitMs). 초과 → 409·쓰기 0.
    // 대기 뒤 holder를 다시 읽는다: 공개됐으면 부착 계층 DB, 아니면 메모리 대기 값.
    if (isUnattached(holder) && attach !== undefined) {
      if (!(await attach.lock.waitIdle(attach.waitMs))) {
        return connectInProgress(c);
      }
    }
    const db = holder?.get()?.db ?? exportDeps?.db;
    if (isUnattached(holder)) {
      if (attach === undefined) {
        return notConnected(c);
      }
      // 게임 행이 없어 숨김 목록은 받을 수 없다.
      if (parsed.value.hidden !== undefined && parsed.value.hidden.length > 0) {
        return invalidBody(c, 'hidden');
      }
      writePendingPrefs(attach.pending, parsed.value);
      return c.json(readPendingPrefs(attach.pending, fallback));
    }
    if (db === undefined) {
      return internalError(c);
    }
    setPrefs(db, parsed.value);
    return c.json(getPrefs(db, fallback));
  });
  app.get(ACHIEVEMENTS_PATH, (c) => {
    // 요청 시작 시 holder 1회 읽기. 미부착이면 메모리 대기 값(기본 false).
    const db = holder?.get()?.db ?? exportDeps?.db;
    if (isUnattached(holder)) {
      if (attach === undefined) {
        return notConnected(c);
      }
      return c.json({ enabled: attach.pending.achievementsEnabled ?? false });
    }
    if (db === undefined) {
      return internalError(c);
    }
    return c.json(getAchievementSettings(db));
  });
  app.put(ACHIEVEMENTS_PATH, async (c) => {
    const parsed = await parseJsonBody(c, achievementsBodyGuard);
    if (!parsed.ok) {
      return parsed.response;
    }
    // 미부착이면 connect 잠금 해제까지 대기(최대 attach.waitMs) 후 다시 읽는다(PUT /api/prefs와 같은 규칙).
    if (isUnattached(holder) && attach !== undefined) {
      if (!(await attach.lock.waitIdle(attach.waitMs))) {
        return connectInProgress(c);
      }
    }
    const db = holder?.get()?.db ?? exportDeps?.db;
    if (isUnattached(holder)) {
      if (attach === undefined) {
        return notConnected(c);
      }
      attach.pending.achievementsEnabled = parsed.value.enabled;
      return c.json({ enabled: parsed.value.enabled });
    }
    if (db === undefined) {
      return internalError(c);
    }
    setAchievementSettings(db, parsed.value);
    return c.json(getAchievementSettings(db));
  });
  // U5-[1] W-S2 — W-S1(info 마운트)와 별도 hunk로 둔다.
  registerSettingsBackupsRoutes(app, settingsDeps, holder);
  app.post(EXPORT_PATH, async (c) => {
    if (isUnattached(holder)) {
      return notConnected(c);
    }
    const parsed = await parseJsonBody(c, exportBodyGuard);
    if (!parsed.ok) {
      return parsed.response;
    }
    // D16-2 — 요청 시작 시 holder 1회 읽기.
    const layer = holder?.get();
    const db = layer?.db ?? exportDeps?.db;
    const exportDir = layer !== undefined ? layer.exportDir : exportDeps?.exportDir;
    if (db === undefined || exportDir === undefined) {
      const body: ExportDeniedBody = {
        code: 'EXPORT_FAILED',
        params: { reason: 'not_configured' },
      };
      return c.json(body, 500);
    }
    try {
      const files = renderExportFiles(
        readExportGames(db),
        parsed.value.locale,
      );
      const { written } = writeExportFiles(exportDir, files);
      return c.json({ written, dir: exportDir });
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
