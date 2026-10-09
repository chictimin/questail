import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** 제품 DB 파일명. 데이터 디렉터리 직하 1파일이다. */
export const DB_FILE_NAME = 'questail.db';

/**
 * DB 열기. 디렉터리를 만들고 WAL 모드로 연다.
 * WAL 일관 복사를 위해 읽기·쓰기 모두 같은 모드로 접근한다.
 */
export function openDatabase(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, DB_FILE_NAME));
  db.pragma('journal_mode = WAL');
  return db;
}
