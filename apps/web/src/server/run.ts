/**
 * W-start 제품 실행 진입점 — main(productionDeps()) 호출만, 다른 로직 0.
 * 정적 UI는 dist-ui를 서빙한다. 빌드 산출 실행: node dist/src/server/run.js.
 */
import { main } from './main.js';
import { createServerApp } from './app.js';
import { productionDeps } from './deps.js';
import { uiDistDir } from './static.js';

await main({
  ...productionDeps(),
  createApp: () => createServerApp({ staticRoot: uiDistDir() }),
});
