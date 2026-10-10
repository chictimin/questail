/**
 * W-start 제품 실행 진입점 — main(productionDeps()) 호출만, 다른 로직 0.
 * 정적 UI는 dist-ui를 서빙한다. 빌드 산출 실행: node dist/src/server/run.js.
 */
import { main } from './main.js';
import { createServerApp } from './app.js';
import { createJobExecutor, createSyncService } from '../data/index.js';
import { deriveDataPaths } from './dataHolder.js';
import { productionDeps, resolveSteamApiBaseUrl, storeBasePair } from './deps.js';
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
  ...productionDeps(process.env, timeZone),
  timeZone,
  // 경로는 계층 생성과 같은 한 곳(deriveDataPaths)에서 만든다 — 기동 부착·연동 부착 공통(B3·B4).
  createSyncService: ({ db, dataDir }) =>
    db === undefined
      ? undefined
      : createSyncService({
          db,
          keyPath: deriveDataPaths(dataDir).keyPath,
          cacheDir: deriveDataPaths(dataDir).cacheDir,
          ...storeBasePair(steamApiBaseUrl),
          timeZone,
          executor: createJobExecutor,
        }),
  createApp: (ctx) => {
    // 파생 경로는 holder 계층에서 읽는다. 미부착(연동 전)이면 계층이 없고 attach가 부착을 맡는다.
    const layer = ctx.holder?.get();
    const dataDir = layer?.dataDir ?? ctx.dataDir;
    const db = layer?.db ?? ctx.db;
    return createServerApp({
      staticRoot: uiDistDir(),
      exportDeps:
        db === undefined
          ? undefined
          : {
              db,
              exportDir: layer?.exportDir ?? ctx.exportDir ?? deriveDataPaths(dataDir).exportDir,
            },
      // 미부착 기동도 connect 라우트는 baseUrl만 들고 있어야 한다(DB·키 경로는 attach가 만든다).
      connectDeps:
        db === undefined
          ? { baseUrl: steamApiBaseUrl }
          : {
              db,
              keyPath: layer?.keyPath ?? ctx.keyPath ?? deriveDataPaths(dataDir).keyPath,
              baseUrl: steamApiBaseUrl,
            },
      settingsDeps: { dataDir, version: ctx.version },
      syncService: layer?.syncService ?? ctx.syncService,
      holder: ctx.holder,
      attach: ctx.attach,
    });
  },
});
