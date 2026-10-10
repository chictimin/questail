/**
 * TEST-HELPER: D16-1 소유 잠금 자식 프로세스.
 * 실행: node <tsx cli> owner-lock-child.ts <boot-holder|boot-tryer> <dataDir>
 * - boot-holder: 실 잠금 + 스텁 deps로 boot() 후 BOOTED를 찍고 SIGTERM까지 유지한다.
 * - boot-tryer: 같은 boot() 1회 — 성공 BOOTED(exit 0) / 실패 BOOT_FAILED:<message>(exit 5).
 * 제품 변경 0. 표준 출력 1행 프로토콜(값·키 원문 없음 — 실패 메시지만).
 */
import { boot, type BootDatabase, type BootDeps } from '../../../src/server/boot.js';

const mode = process.argv[2];
const dataDir = process.argv[3];

if (mode === undefined || dataDir === undefined) {
  console.error('usage: owner-lock-child.ts <mode> <dataDir>');
  process.exit(2);
}

function hold(): void {
  // 유지 타이머 — SIGTERM이면 그대로 종료하고 OS가 잠금을 해제한다.
  setInterval(() => undefined, 1000);
}

if (mode === 'boot-holder' || mode === 'boot-tryer') {
  const db: BootDatabase = { close: async () => undefined };
  const deps: BootDeps = {
    env: { QUESTAIL_DATA_DIR: dataDir },
    timeZone: 'UTC',
    backupDatabase: async () => undefined,
    migrateDatabase: async () => db,
    isConnected: () => false,
    runOverdueSnapshot: async () => undefined,
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
    const booted = await boot(deps);
    void booted.background.catch(() => undefined);
    if (mode === 'boot-holder') {
      console.log('BOOTED');
      hold();
    } else {
      console.log('BOOTED');
      process.exit(0);
    }
  } catch (error) {
    console.log(`BOOT_FAILED:${error instanceof Error ? error.message : String(error)}`);
    process.exit(5);
  }
} else {
  console.error(`unknown mode: ${mode}`);
  process.exit(2);
}
