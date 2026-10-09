/**
 * W5 연동 라우트 — GET /api/connect/status · POST /api/connect.
 * 키 경로는 호출 측이 dataDir에서 만들어 준다(run.ts, connectKeyPath).
 * fetchFn은 제품에서 생략(전역 fetch), 테스트 주입용이다.
 * 고정 ID 거부는 Steam 검증보다 먼저(saveConnection 순서, hemo #67489) — Steam 호출 없이 409.
 * 실패 본문은 {code, params}만(원문·키 미반향, L-1).
 */
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { SyncErrorCode } from '@questail/core';
import type { Hono } from 'hono';
import type { VerifyFetchFn } from '../../data/connection.js';
import { KEY_FILE_NAME, getConnection, saveConnection } from '../../data/index.js';
import { createLogger } from '../logging.js';
import { parseJsonBody, type BodyGuard } from '../validate.js';

export const CONNECT_STATUS_PATH = '/api/connect/status';
export const CONNECT_PATH = '/api/connect';

export type ConnectDeps = {
  db: Database.Database;
  keyPath: string;
  fetchFn?: VerifyFetchFn;
};

/** 키 경로 = <dataDir>/KEY_FILE_NAME. 경로는 서버가 주입한다. */
export function connectKeyPath(dataDir: string): string {
  return join(dataDir, KEY_FILE_NAME);
}

type ConnectFailBody = {
  code: SyncErrorCode;
  params: Record<string, string | number>;
};

type ConnectRequest = { keyText: string; steamId: string };

/** 타입 검사만 한다. 형태 검사는 saveConnection이 맡긴다(결정 3). 키 원문은 params에 싣지 않는다. */
const connectBodyGuard: BodyGuard<ConnectRequest> = (unknownBody) => {
  if (typeof unknownBody !== 'object' || unknownBody === null) {
    return { ok: false, params: { reason: 'body' } };
  }
  const record = unknownBody as Record<string, unknown>;
  if (
    typeof record.keyText !== 'string' ||
    record.keyText === '' ||
    typeof record.steamId !== 'string' ||
    record.steamId === ''
  ) {
    return { ok: false, params: { reason: 'body' } };
  }
  return { ok: true, value: { keyText: record.keyText, steamId: record.steamId } };
};

/** 승인 매핑(#67025): 401 미사용(입력값 문제라 400). 그 외는 아래. */
function statusFor(code: SyncErrorCode): 400 | 409 | 429 | 500 | 502 {
  switch (code) {
    case 'AUTH_INVALID_KEY':
      return 400;
    case 'AUTH_ID_MISMATCH':
      return 409;
    case 'KEY_STORE_FAILED':
      return 500;
    case 'RATE_LIMITED':
      return 429;
    default:
      return 502;
  }
}

/** 앱 인스턴스당 직렬화 상태는 클로저에 둔다(모듈 전역 없음). */
export function registerConnectRoutes(app: Hono, deps?: ConnectDeps): void {
  let inFlight = false;

  app.get(CONNECT_STATUS_PATH, (c) => {
    if (deps === undefined) {
      throw new Error('[web] connect 미배선 — deps 없음');
    }
    return c.json(getConnection(deps.db));
  });

  app.post(CONNECT_PATH, async (c) => {
    const parsed = await parseJsonBody(c, connectBodyGuard);
    if (!parsed.ok) {
      return parsed.response;
    }
    if (deps === undefined) {
      throw new Error('[web] connect 미배선 — deps 없음');
    }
    if (inFlight) {
      return c.json({ code: 'CONNECT_IN_PROGRESS', params: {} }, 409);
    }
    inFlight = true;
    // 요청 스코프 로거 — 이 요청의 keyText만 알고 요청 종료 후 보관 없음.
    const log = createLogger([parsed.value.keyText]);
    try {
      const result = await saveConnection({
        db: deps.db,
        keyPath: deps.keyPath,
        keyText: parsed.value.keyText,
        steamId: parsed.value.steamId,
        fetchFn: deps.fetchFn,
      });
      if (result.ok) {
        return c.json({ connected: true }, 200);
      }
      log.error(`[web] connect 실패: ${result.code}`);
      const body: ConnectFailBody = { code: result.code, params: result.params };
      return c.json(body, statusFor(result.code));
    } catch (error) {
      log.error('[web] connect 예외');
      throw error;
    } finally {
      inFlight = false;
    }
  });
}
