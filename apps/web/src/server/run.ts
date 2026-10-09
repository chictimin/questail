/**
 * W-start 제품 실행 진입점 — main(productionDeps()) 호출만, 다른 로직 0.
 * 정적 UI는 dist-ui를 서빙한다. 빌드 산출 실행: node dist/src/server/run.js.
 */
import { join } from 'node:path';
import { META_CACHE_DIR_NAME } from '@questail/core';
import { main } from './main.js';
import { createServerApp } from './app.js';
import { createJobExecutor, createSyncService } from '../data/index.js';
import { EXPORT_DIR_NAME } from './export.js';
import { productionDeps, resolveSteamApiBaseUrl } from './deps.js';
import { connectKeyPath } from './routes/connect.js';
import { uiDistDir } from './static.js';

/**
 * P-6: 테스트용 base URL은 env에서 1회 읽어 정규화한다.
 * 거부면 throw(값·키·경로 없이 기동 실패). 없으면 기존 동작 그대로.
 */
const steamApiBaseUrl = resolveSteamApiBaseUrl(process.env);
if (steamApiBaseUrl !== undefined) {
  console.error('[web] 테스트용 Steam API base 사용 중 (기본값 아님)');
}

/**
 * U3b+W13: 표시 시간대 1회 결정 — syncDeps가 쓰고 W-cron-2 scheduler도 같은 값 참조.
 * (scheduler 배선은 paru 몫, 여기서는 변수까지만)
 */
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

await main({
  ...productionDeps(),
  createSyncService: ({ db, dataDir }) =>
    db === undefined
      ? undefined
      : createSyncService({
          db,
          keyPath: connectKeyPath(dataDir),
          cacheDir: join(dataDir, META_CACHE_DIR_NAME),
          baseUrl: steamApiBaseUrl,
          timeZone,
          executor: createJobExecutor,
        }),
  createApp: (ctx) =>
    createServerApp({
      staticRoot: uiDistDir(),
      exportDeps:
        ctx.db === undefined
          ? undefined
          : { db: ctx.db, exportDir: join(ctx.dataDir, EXPORT_DIR_NAME) },
      connectDeps:
        ctx.db === undefined
          ? undefined
          : {
              db: ctx.db,
              keyPath: connectKeyPath(ctx.dataDir),
              baseUrl: steamApiBaseUrl,
            },
      settingsDeps: { dataDir: ctx.dataDir, version: ctx.version },
      syncService: ctx.syncService,
    }),
});
