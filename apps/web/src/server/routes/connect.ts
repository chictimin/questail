/**
 * W5 연동 라우트 — GET /api/connect/status · POST /api/connect.
 * 키 경로는 호출 측이 dataDir에서 만들어 준다(run.ts, connectKeyPath).
 * fetchFn은 제품에서 생략(전역 fetch), 테스트 주입용이다.
 * 고정 ID 거부는 Steam 검증보다 먼저(saveConnection 순서, hemo #67489) — Steam 호출 없이 409.
 * 실패 본문은 {code, params}만(원문·키 미반향, L-1).
 */
import type Database from 'better-sqlite3';
import { resolveVanityName, type SyncErrorCode } from '@questail/core';
import type { Hono } from 'hono';
import type { VerifyFetchFn } from '../../data/connection.js';
import { getConnection, saveConnection } from '../../data/index.js';
import { unconnectedStatus } from '../../data/connection.js';
import { createConnectLock, type AttachController } from '../attach.js';
import { createLogger } from '../logging.js';
import { deriveDataPaths, type DataHolder } from '../dataHolder.js';
import { ACCOUNT_DIR_PATTERN } from '../dataLocation.js';
import { parseJsonBody, type BodyGuard } from '../validate.js';

export const CONNECT_STATUS_PATH = '/api/connect/status';
export const CONNECT_PATH = '/api/connect';

export type ConnectDeps = {
  /** 미부착 기동에서는 없다(attach 경로가 폴더를 만들며 계층에서 읽는다). */
  db?: Database.Database;
  keyPath?: string;
  fetchFn?: VerifyFetchFn;
  /** P-6 테스트 주입용 base URL. 없으면 공식 기본. */
  baseUrl?: string;
};

/** 키 경로 = deriveDataPaths(dataDir).keyPath(경로 조립 단일 출처). 경로는 서버가 주입한다. */
export function connectKeyPath(dataDir: string): string {
  return deriveDataPaths(dataDir).keyPath;
}

type ConnectFailBody = {
  code: SyncErrorCode;
  params: Record<string, string | number>;
};

type ConnectRequest = { keyText: string; steamId: string; vanity?: string; achievementsEnabled?: boolean };

/**
 * 타입 검사만 한다. 형태 검사는 saveConnection이 맡긴다(결정 3). 키 원문은 params에 싣지 않는다.
 * vanity는 선택 — 있으면 비어 있지 않은 문자열만, 빈 값은 INVALID_BODY.
 * achievementsEnabled는 선택 — 있으면 boolean만, 아니면 INVALID_BODY(Steam 요청 0).
 */
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
  if (record.achievementsEnabled !== undefined && typeof record.achievementsEnabled !== 'boolean') {
    return { ok: false, params: { reason: 'body' } };
  }
  const optional =
    record.achievementsEnabled === undefined
      ? {}
      : { achievementsEnabled: record.achievementsEnabled };
  if (record.vanity !== undefined) {
    if (typeof record.vanity !== 'string' || record.vanity === '') {
      return { ok: false, params: { reason: 'body' } };
    }
    return {
      ok: true,
      value: { keyText: record.keyText, steamId: record.steamId, vanity: record.vanity, ...optional },
    };
  }
  return { ok: true, value: { keyText: record.keyText, steamId: record.steamId, ...optional } };
};

/** 승인 매핑(#67025): 401 미사용(입력값 문제라 400). 그 외는 아래. */
function statusFor(code: SyncErrorCode): 400 | 409 | 429 | 500 | 502 {
  switch (code) {
    case 'AUTH_INVALID_KEY':
      return 400;
    case 'AUTH_ID_MISMATCH':
      // 고정 계정·대상 계정과의 충돌로 본다 — not_found 포함, 계약 v1.4.1 P-5
      return 409;
    case 'KEY_STORE_FAILED':
      return 500;
    case 'RATE_LIMITED':
      return 429;
    default:
      return 502;
  }
}

/**
 * 앱 인스턴스당 직렬화 상태는 클로저에 둔다(모듈 전역 없음).
 * attach(미부착 기동)가 있으면 잠금도 그 컨트롤러 것을 쓴다 — 부착 중 PUT이 같은 잠금을 기다린다.
 */
export function registerConnectRoutes(
  app: Hono,
  deps?: ConnectDeps,
  holder?: DataHolder,
  attach?: AttachController,
): void {
  const lock = attach?.lock ?? createConnectLock();

  app.get(CONNECT_STATUS_PATH, (c) => {
    // 요청 시작 시 holder 1회 읽기. 미부착이면 DB 없이 연결 안 됨 응답.
    const layer = holder?.get();
    if (holder !== undefined && layer === undefined) {
      return c.json(unconnectedStatus());
    }
    if (deps === undefined) {
      throw new Error('[web] connect 미배선 — deps 없음');
    }
    const db = layer?.db ?? deps.db;
    if (db === undefined) {
      throw new Error('[web] connect 미배선 — deps 없음');
    }
    return c.json(getConnection(db));
  });

  app.post(CONNECT_PATH, async (c) => {
    const parsed = await parseJsonBody(c, connectBodyGuard);
    if (!parsed.ok) {
      return parsed.response;
    }
    // 요청 시작 시 holder 1회 읽기.
    const layer = holder?.get();
    const unattached = holder !== undefined && layer === undefined && attach !== undefined;
    if (!unattached) {
      if (deps === undefined) {
        throw new Error('[web] connect 미배선 — deps 없음');
      }
    }
    const db = layer?.db ?? deps?.db;
    const keyPath = layer?.keyPath ?? deps?.keyPath;
    if (!unattached && (db === undefined || keyPath === undefined)) {
      throw new Error('[web] connect 미배선 — deps 없음');
    }
    const release = lock.tryAcquire();
    if (release === null) {
      return c.json({ code: 'CONNECT_IN_PROGRESS', params: {} }, 409);
    }
    // 요청 스코프 로거 — 이 요청의 keyText만 알고 요청 종료 후 보관 없음.
    const log = createLogger([parsed.value.keyText]);
    // P-7: vanity가 있으면 steamId를 무시하고 resolve 결과 id만 쓴다. 파싱 위치는 UI 하나.
    const fail = (code: SyncErrorCode, params: Record<string, string | number>): Response => {
      log.error(`[web] connect 실패: ${code}`);
      const body: ConnectFailBody = { code, params };
      return c.json(body, statusFor(code));
    };
    try {
      let steamId = parsed.value.steamId;
      if (parsed.value.vanity !== undefined) {
        const resolved = await resolveVanityName({
          vanity: parsed.value.vanity,
          keyText: parsed.value.keyText,
          baseUrl: deps?.baseUrl,
          fetchFn: deps?.fetchFn,
          ...(unattached && attach !== undefined ? { signal: attach.signal } : {}),
        });
        if (!resolved.ok) {
          return fail(resolved.code, resolved.params);
        }
        steamId = resolved.steamId;
      }
      // 비형식 ID는 Steam 요청 전에 거부(미부착·부착 공통). vanity 경로는 resolve 결과 id에 같은 검사.
      if (!ACCOUNT_DIR_PATTERN.test(steamId)) {
        return fail('AUTH_ID_MISMATCH', { reason: 'not_found' });
      }
      if (unattached && attach !== undefined) {
        // [부착] 1~5 — 잠금 보유 중. 6(시작)은 attach가 background로 낸다.
        const attached = await attach.connect({
          keyText: parsed.value.keyText,
          steamId,
          achievementsEnabled: parsed.value.achievementsEnabled,
          fetchFn: deps?.fetchFn,
          baseUrl: deps?.baseUrl,
        });
        if (attached.ok) {
          return c.json({ connected: true }, 200);
        }
        return fail(attached.code, attached.params);
      }
      const result = await saveConnection({
        db: db as Database.Database,
        keyPath: keyPath as string,
        keyText: parsed.value.keyText,
        steamId,
        achievementsEnabled: parsed.value.achievementsEnabled,
        fetchFn: deps?.fetchFn,
        baseUrl: deps?.baseUrl,
      });
      if (result.ok) {
        return c.json({ connected: true }, 200);
      }
      return fail(result.code, result.params);
    } catch (error) {
      log.error('[web] connect 예외');
      throw error;
    } finally {
      release();
    }
  });
}
