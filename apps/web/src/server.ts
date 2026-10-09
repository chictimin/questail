/**
 * S6a bootstrap 최소 서버 — GET /api/health → 200 만 제공한다.
 * W2(Hono 배선·Host/Origin 검사·hc·정적 UI 서빙)는 이 파일 밖에 둔다.
 */
import { createServer as createHttpServer, type Server } from 'node:http';

export const HEALTH_PATH = '/api/health';

/** 라우트 판정(순수 함수 — 단위 테스트 대상). */
export function matchRoute(
  method: string | undefined,
  url: string | undefined,
): { status: number; body: unknown } {
  const path = (url ?? '').split('?')[0];
  if (method === 'GET' && path === HEALTH_PATH) {
    return { status: 200, body: { status: 'ok' } };
  }
  return { status: 404, body: { status: 'not_found' } };
}

/** 최소 HTTP 서버를 만든다. listen은 호출자가 한다(E2E는 임시 포트). */
export function createServer(): Server {
  return createHttpServer((req, res) => {
    const { status, body } = matchRoute(req.method, req.url);
    const payload = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(payload);
  });
}

/** 127.0.0.1 임시 포트 listen → 실제 포트를 돌려준다. */
export function listen(server: Server, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (address !== null && typeof address === 'object') {
        resolve(address.port);
      } else {
        reject(new Error('server address unavailable'));
      }
    });
  });
}
