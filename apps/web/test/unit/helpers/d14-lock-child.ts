/**
 * TEST-HELPER: D-14 BUSY 시험용 잠금 보유 자식 프로세스.
 * 실행: node <tsx cli> d14-lock-child.ts <dataDir> — 잠금 취득 후 LOCKED를 찍고 SIGTERM까지 유지한다.
 */
import { acquireOwnerLock } from '../../../src/db/ownerLock.js';

const dataDir = process.argv[2];
if (dataDir === undefined) {
  console.error('usage: d14-lock-child.ts <dataDir>');
  process.exit(2);
}
acquireOwnerLock(dataDir);
console.log('LOCKED');
setInterval(() => undefined, 1000);
