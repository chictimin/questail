import Database from 'better-sqlite3';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

/**
 * D16-1 소유 잠금(P-12 ⑥). DB를 여는 모든 프로세스는 연 DB가 있는
 * 디렉터리 D의 잠금 파일 D/.owner.lock을 DB 열기 전에 먼저 취득한다.
 * better-sqlite3 연결(busy timeout 0, journal_mode 기본 delete)로
 * BEGIN EXCLUSIVE를 프로세스 수명 동안 유지한다(OS 파일 잠금 —
 * 프로세스가 죽으면 OS가 즉시 해제, stale 회수 절차 없음).
 * 진단용 pid 1행은 취득 후 같은 트랜잭션에서 기록하고 판정에는 쓰지 않는다.
 * 해제 = 프로세스 종료(명시 해제·파일 삭제 없음).
 */
export const OWNER_LOCK_FILE_NAME = '.owner.lock';

/** 취득 실패(SQLITE_BUSY) 시 기동 실패 안내 — 값·키·경로 원문 없음. */
export const OWNER_LOCK_BUSY_MESSAGE =
  '[web] 다른 Questail 프로세스가 같은 데이터 폴더를 쓰는 중';
/** BUSY 외 취득 실패 시 기동 실패 안내 — 값·키·경로 원문 없음. */
export const OWNER_LOCK_UNAVAILABLE_MESSAGE =
  '[web] 데이터 폴더 소유 잠금을 취득하지 못해 기동하지 못함';

export type OwnerLock = {
  readonly filePath: string;
  readonly connection: Database.Database;
};

/**
 * 잠금 레지스트리 — 실경로 단위 프로세스 내 1회 취득·연결 재사용.
 * 같은 파일에 두 번째 연결로 BEGIN EXCLUSIVE를 시도하면 자기 자신에게
 * SQLITE_BUSY가 나므로 같은 연결을 돌려준다.
 */
const registry = new Map<string, OwnerLock>();

/** SQLITE_BUSY 계열(경합) 판정 — busy timeout 0이라 대기가 아닌 즉시 실패다. */
export function isOwnerLockBusy(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('SQLITE_BUSY');
}

/**
 * 소유 잠금 취득. 디렉터리를 만들고 실경로 기준으로 등록한다.
 * 경합이면 호출자가 받은 better-sqlite3 원본 오류 그대로 던진다
 * (기동 실패 안내 변환은 boot이 맡는다).
 */
export function acquireOwnerLock(dataDir: string): OwnerLock {
  mkdirSync(dataDir, { recursive: true });
  const realDir = realpathSync(dataDir);
  const existing = registry.get(realDir);
  if (existing !== undefined) {
    return existing;
  }
  const filePath = join(realDir, OWNER_LOCK_FILE_NAME);
  const connection = new Database(filePath, { timeout: 0 });
  try {
    connection.pragma('busy_timeout = 0');
    connection.pragma('journal_mode = delete');
    connection.exec('BEGIN EXCLUSIVE');
    try {
      connection.exec(
        'CREATE TABLE IF NOT EXISTS owner_lock (pid INTEGER NOT NULL)',
      );
      connection.prepare('DELETE FROM owner_lock').run();
      connection.prepare('INSERT INTO owner_lock (pid) VALUES (?)').run(process.pid);
    } catch (error) {
      try {
        connection.exec('ROLLBACK');
      } catch {
        /* 롤백 실패는 원본 오류를 유지한다 */
      }
      throw error;
    }
    // COMMIT 없음 — 프로세스 수명 동안 트랜잭션을 유지한다.
  } catch (error) {
    connection.close();
    throw error;
  }
  const handle: OwnerLock = { filePath, connection };
  registry.set(realDir, handle);
  return handle;
}
