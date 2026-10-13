/**
 * R15-9 데이터 서비스 포트 — `readLibraryRecap(db): LibraryRecap`.
 * 집계 본체는 core 실함수 T1(`computeRecapSections` + `assembleLibraryRecap`,
 * `packages/core/src/recap/compute.ts`)을 호출한다. 07 요약은 core `toCardSummary`
 * (`packages/core/src/recap/summary.ts`)로 만든다.
 * TBTI 입력은 T2 `judgeTbti` 도착 전까지 `readTbti()` 목업을 쓴다(교체 지점 T2).
 */
import type Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import {
  assembleLibraryRecap,
  computeRecapSections,
  toCardSummary,
  type LibraryRecap,
} from '@questail/core';
import { syncRuns } from '../db/schema.js';
import { listGameFacts } from './archiveRead.js';
import { readAccountCreatedAt } from './account.js';
import { readTbti } from './tbti.js';

/**
 * owned 소스 ok run의 observedDay 목록 — `basis.observedDays`의 직접 입력(R20).
 * 웹이 sync_runs에서 조립한다(신규 리더, 스키마 변경 없음).
 */
export function readOwnedObservedDays(db: Database.Database): string[] {
  const rows = drizzle(db)
    .selectDistinct({ observedDay: syncRuns.observedDay })
    .from(syncRuns)
    .where(and(eq(syncRuns.source, 'owned'), eq(syncRuns.status, 'ok')))
    .all();
  return rows.map((row) => row.observedDay);
}

/**
 * 전체 recap 읽기 포트. 입력 조립은 실물 리더기 재사용
 * (`listGameFacts` hidden 포함 원본 — core 내부에서 hidden 제외 R15-2 ①,
 * `readAccountCreatedAt`, `readOwnedObservedDays`).
 * 행 없는 account는 미확인(null)으로 둔다 → s06 comparePrevYear=false.
 */
export function readLibraryRecap(db: Database.Database): LibraryRecap {
  let accountCreatedAt: number | null;
  try {
    accountCreatedAt = readAccountCreatedAt(db);
  } catch {
    accountCreatedAt = null;
  }
  // 교체 지점(T2): T2 `judgeTbti` 도착 시 이 목업을 실판정 호출로 바꾼다.
  const tbti = readTbti(db);
  const sections = computeRecapSections({
    games: listGameFacts(db),
    accountCreatedAt,
    now: Math.floor(Date.now() / 1000),
    ownedObservedDays: readOwnedObservedDays(db),
    tbti,
  });
  return assembleLibraryRecap(sections, toCardSummary(tbti));
}
