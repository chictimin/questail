/**
 * TEST-HELPER: 제품 main() 경유 자식 프로세스(D16-A 종료 상한).
 * 실행: node <tsx cli> product-main-child.ts <clean|hang> <dataDir> <capMs>
 * - clean: 정상 정리 — SIGTERM 뒤 정리가 끝나면 main이 process.exit(0)해야 한다.
 * - hang: background(runOverdueSnapshot)가 signal을 무시하고 영원히 대기 — 상한에 도달해야 종료한다.
 * 유지 타이머가 이벤트 루프를 붙잡아 main의 process.exit 없이는 자연 종료하지 않는다.
 * 합성 데이터 폴더·스텁 deps만 쓴다(실 Steam 0). 표준 출력 1행 프로토콜.
 */
import { main } from '../../../src/server/main.js';
import type { BootDatabase, BootDeps } from '../../../src/server/boot.js';

const [mode, dataDir, capRaw] = process.argv.slice(2);
if ((mode !== 'clean' && mode !== 'hang') || dataDir === undefined || capRaw === undefined) {
  console.error('usage: product-main-child.ts <clean|hang> <dataDir> <capMs>');
  process.exit(2);
}

const db: BootDatabase = { close: async () => undefined };
const deps: BootDeps = {
  env: { QUESTAIL_DATA_DIR: dataDir },
  timeZone: 'UTC',
  backupDatabase: async () => undefined,
  migrateDatabase: async () => db,
  isConnected: () => mode === 'hang',
  runOverdueSnapshot: () => new Promise<void>(() => undefined),
  registerCron: () => ({ unregister: () => undefined }),
  listen: async () => ({
    server: {
      close: (callback: (error?: Error) => void) => callback(),
      closeIdleConnections: () => undefined,
    } as never,
    port: 0,
  }),
};

try {
  await main(deps, { shutdownCapMs: Number(capRaw) });
  console.log('BOOTED');
  setInterval(() => undefined, 1000);
} catch (error) {
  console.log(`BOOT_FAILED:${error instanceof Error ? error.message : String(error)}`);
  process.exit(5);
}
