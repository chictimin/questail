/**
 * 데이터 계층 holder(P-12). boot·app·routes·shutdown이 db·syncService·cron·
 * background·keyPath·cacheDir·exportDir를 기동 closure가 아니라 이 holder에서 읽는다.
 * 요청은 시작 시 1회 읽기. 미부착(연동 전)이면 get()이 undefined다 —
 * 부착은 D16-3 attach 경로의 set 1회뿐이고 되돌리지 않는다.
 */
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { META_CACHE_DIR_NAME } from '@questail/core';
import { KEY_FILE_NAME } from '../data/connection.js';
import type { SyncService } from '../data/service.js';
import type { BootDatabase, CronHandle } from './boot.js';
import { EXPORT_DIR_NAME } from './export.js';

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

/** 데이터 폴더 D에서 파생되는 경로 — 키(600)·메타 캐시·내보내기. 계층 생성의 단일 출처(B3·B4). */
export type DataPaths = {
  keyPath: string;
  cacheDir: string;
  exportDir: string;
};

export function deriveDataPaths(dataDir: string): DataPaths {
  return {
    keyPath: join(dataDir, KEY_FILE_NAME),
    cacheDir: join(dataDir, META_CACHE_DIR_NAME),
    exportDir: join(dataDir, EXPORT_DIR_NAME),
  };
}

/** 계층 생성 함수 — 기동 부착과 연동 부착(T 경로)이 같은 값을 만든다. */
export function createDataLayer(input: {
  db: Database.Database | undefined;
  bootDb: BootDatabase;
  dataDir: string;
  version: string;
  syncService?: SyncService;
}): DataLayer {
  return {
    db: input.db,
    bootDb: input.bootDb,
    dataDir: input.dataDir,
    version: input.version,
    ...(input.syncService === undefined ? {} : { syncService: input.syncService }),
    ...deriveDataPaths(input.dataDir),
  };
}

export type DataHolder = {
  /** 현재 계층. 미부착이면 undefined. */
  get: () => DataLayer | undefined;
  set: (next: DataLayer) => void;
};

export function createDataHolder(initial?: DataLayer): DataHolder {
  let current = initial;
  return {
    get: () => current,
    set: (next: DataLayer) => {
      current = next;
    },
  };
}
