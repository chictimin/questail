/**
 * R15-1 입력 2 포트 — `readAccountCreatedAt(db): number`.
 * account 테이블 id=1 createdAt 읽기 재사용(connection.ts readAccountRow와 같은 조회).
 * 스키마 변경 없음. 행 없음·NULL이면 throw한다(호출 측이 500으로 답한다).
 */
import type Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { account } from '../db/schema.js';

export function readAccountCreatedAt(db: Database.Database): number {
  const row = drizzle(db)
    .select({ createdAt: account.createdAt })
    .from(account)
    .where(eq(account.id, 1))
    .get();
  if (row === undefined || row.createdAt === null) {
    throw new Error('[web] account row missing (id=1)');
  }
  return row.createdAt;
}
