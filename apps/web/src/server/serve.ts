/**
 * W2 listen 배선 — 127.0.0.1 명시 바인딩. 포트 기본 4747, QUESTAIL_PORT로 덮어쓰기.
 * 사용 중이면 기동 실패 + 안내(자동 다른 포트 없음, PM #61255 Q3).
 */
import { serve, type ServerType } from '@hono/node-server';
import type { Hono } from 'hono';

export const DEFAULT_PORT = 4747;
export const HOST = '127.0.0.1';
export const PORT_ENV = 'QUESTAIL_PORT';

/** 포트 결정 — 숫자·1~65535가 아니면 기동 실패 + 안내. */
export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[PORT_ENV];
  if (raw === undefined || raw === '') {
    return DEFAULT_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `[web] ${PORT_ENV}="${raw}" — 1~65535 정수를 넣어 다시 기동해라 (기본 ${DEFAULT_PORT})`,
    );
  }
  return port;
}

export type StartedServer = {
  server: ServerType;
  port: number;
};

/**
 * 기동 — 실제 포트와 서버를 돌려준다. EADDRINUSE면 안내와 함께 실패한다.
 * 닫기는 호출자가 server.close()로 한다(테스트·W3 기동이 맡음).
 */
export function startServer(app: Hono, port: number): Promise<StartedServer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = serve(
      { fetch: app.fetch, port, hostname: HOST },
      (info) => {
        settled = true;
        resolve({ server: server as ServerType, port: info.port });
      },
    );
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      if (error.code === 'EADDRINUSE') {
        reject(
          new Error(
            `[web] 포트 ${port} 사용 중 — 점유 프로세스를 끝내거나 ${PORT_ENV}로 다른 포트를 지정해 다시 기동해라`,
          ),
        );
      } else {
        reject(error);
      }
    });
  });
}
