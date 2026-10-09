/**
 * W-start 제품 실행 진입점 — main(productionDeps()) 호출만, 다른 로직 0.
 * 정적 UI는 dist-ui를 서빙한다. 빌드 산출 실행: node dist/src/server/run.js.
 */
import { join } from 'node:path';
import { main } from './main.js';
import { createServerApp } from './app.js';
import { productionDeps } from './deps.js';
import { connectKeyPath } from './routes/connect.js';
import { uiDistDir } from './static.js';

await main({
  ...productionDeps(),
  createApp: (ctx) =>
    createServerApp({
      staticRoot: uiDistDir(),
      exportDeps:
        ctx.db === undefined
          ? undefined
          : { db: ctx.db, exportDir: join(ctx.dataDir, 'export') },
      connectDeps:
        ctx.db === undefined
          ? undefined
          : { db: ctx.db, keyPath: connectKeyPath(ctx.dataDir) },
    }),
});
