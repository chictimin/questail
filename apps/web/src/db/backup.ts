import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DB_FILE_NAME } from './open.js';

/** 백업 디렉터리명. 데이터 디렉터리 직하이다. */
export const BACKUP_DIR_NAME = 'backups';

/** 백업 파일명. UTC 시각 태그를 포함한다. */
export function backupFileName(now: Date = new Date()): string {
  return `questail-${now.toISOString().replace(/[:.]/g, '-')}.db`;
}

/**
 * DB 백업. better-sqlite3 온라인 백업 API로 WAL 포함 일관 복사한다.
 * 파일 직접 복사가 아니라 WAL 반영 시점을 API가 보장한다.
 * DB 파일이 없으면(첫 기동) 아무 것도 하지 않는다.
 * 개수 정책은 없다.
 */
export async function backupDatabase(dataDir: string, now?: Date): Promise<void> {
  const source = join(dataDir, DB_FILE_NAME);
  if (!existsSync(source)) {
    return;
  }
  const outDir = join(dataDir, BACKUP_DIR_NAME);
  mkdirSync(outDir, { recursive: true });
  const db = new Database(source, { readonly: true });
  try {
    await db.backup(join(outDir, backupFileName(now)));
  } finally {
    db.close();
  }
}
