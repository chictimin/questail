/**
 * W2 Host/Origin 검사 미들웨어 (PM #61255 Q2).
 * 허용: Host·Origin의 호스트가 127.0.0.1·localhost. Origin 없음 → 통과.
 * 거부: 403 + {code, params}.
 */
import type { Context, Next } from 'hono';
import type { RequestDeniedBody } from '../request-errors.js';

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** Host 값에서 호스트만 떼낸다(포트·IPv6 대괄호 처리). 없음 → null(거부). */
export function parseHostName(host: string | null | undefined): string | null {
  if (host === null || host === undefined || host === '') {
    return null;
  }
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(1, end);
  }
  return host.split(':')[0] ?? null;
}

/** Origin 값이 허용 목록에 드는지. null(헤더 없음)은 호출자가 통과시킨다. */
export function isAllowedOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    ALLOWED_HOSTS.has(url.hostname)
  );
}

export async function hostCheck(c: Context, next: Next): Promise<Response | void> {
  const hostName = parseHostName(c.req.header('host'));
  if (hostName === null || !ALLOWED_HOSTS.has(hostName)) {
    const body: RequestDeniedBody = {
      code: 'INVALID_HOST',
      params: { host: c.req.header('host') ?? '' },
    };
    return c.json(body, 403);
  }
  const origin = c.req.header('origin');
  if (origin !== undefined && !isAllowedOrigin(origin)) {
    const body: RequestDeniedBody = {
      code: 'INVALID_ORIGIN',
      params: { origin },
    };
    return c.json(body, 403);
  }
  return next();
}
