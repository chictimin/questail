/**
 * D16-2 데이터 계층 holder(동작 변화 0).
 * boot·app·routes·shutdown이 db·syncService·cron·background·keyPath·
 * cacheDir·exportDir를 기동 closure가 아니라 이 holder에서 읽는다.
 * 이 단위에서는 기동 시 항상 부착(현행과 같음) — holder는 1회 set되고
 * 이후 set은 D16-3 부착 경로에서만 일어난다. 요청은 시작 시 1회 읽기.
 */
import type Database from 'better-sqlite3';
import type { SyncService } from '../data/service.js';
import type { BootDatabase, CronHandle } from './boot.js';

export type DataLayer = {
  /** 라우트·서비스가 쓰는 raw 핸들. */
  db: Database.Database | undefined;
  /** shutdown ⑤ DB close용 boot 핸들. */
  bootDb: BootDatabase;
  dataDir: string;
  version: string;
  syncService?: SyncService;
  keyPath: string;
  cacheDir: string;
  exportDir: string;
  cron?: CronHandle;
  background?: Promise<void>;
};

export type DataHolder = {
  get: () => DataLayer;
  set: (next: DataLayer) => void;
};

export function createDataHolder(initial: DataLayer): DataHolder {
  let current = initial;
  return {
    get: () => current,
    set: (next: DataLayer) => {
      current = next;
    },
  };
}
