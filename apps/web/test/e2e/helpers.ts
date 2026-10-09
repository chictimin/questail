import type { StartedServer } from '../../src/server/serve.js';

/**
 * TEST-HELPER: E2E 서버 종료 공용 유틸.
 * keep-alive 유휴 연결이 close 콜백을 붙잡는 hang 방지(TEST-F1) — 먼저 끊고 닫는다.
 * 제품 변경 0. 임시 디렉터리는 각 spec이 mkdtemp로 만든 것을 그대로 정리한다.
 */
export async function stopServer(server: StartedServer): Promise<void> {
  if ('closeAllConnections' in server.server) {
    server.server.closeAllConnections();
  }
  await new Promise<void>((resolve, reject) => {
    server.server.close((error: Error | undefined) =>
      error ? reject(error) : resolve(),
    );
  });
}
