/**
 * R15-1 입력 2 포트 — `readAccountCreatedAt(db): number | null`.
 * account 테이블 id=1 createdAt 읽기 재사용(connection.ts readAccountRow와 같은 조회).
 * 스키마 변경 없음. 행 없음·createdAt NULL은 null(미확인), 쿼리 자체 실패는 throw한다.
 */
import type Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { account } from '../db/schema.js';

export function readAccountCreatedAt(db: Database.Database): number | null {
  let row: { createdAt: number | null } | undefined;
  try {
    row = drizzle(db)
      .select({ createdAt: account.createdAt })
      .from(account)
      .where(eq(account.id, 1))
      .get();
  } catch {
    throw new Error('[web] account read failed (id=1)');
  }
  if (row === undefined || row.createdAt === null) {
    return null;
  }
  return row.createdAt;
}
