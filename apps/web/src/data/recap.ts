/**
 * R15-9 데이터 서비스 포트 — `readLibraryRecap(db, dataDir): LibraryRecap`.
 * 집계 본체는 core 실함수 T1(`computeRecapSections` + `assembleLibraryRecap`,
 * `packages/core/src/recap/compute.ts`)을 호출한다. 07 요약은 core `toCardSummary`
 * (`packages/core/src/recap/summary.ts`)로 만든다.
 * 판정 1회 원칙 — `judgeTbti`를 1회만 호출해 그 결과를 섹션 입력과 요약 둘 다에 쓴다.
 */
import type Database from 'better-sqlite3';
import {
  assembleLibraryRecap,
  computeRecapSections,
  judgeTbti,
  toCardSummary,
  type LibraryRecap,
} from '@questail/core';
import { readAccountCreatedAt } from './account.js';
import { readTbtiJudgeInput } from './tbti.js';

/**
 * 전체 recap 읽기 포트. 입력 조립은 실물 리더기 재사용
 * (`listGameFacts` hidden 포함 원본 — core 내부에서 hidden 제외 R15-2 ①,
 * `readAccountCreatedAt`, `readOwnedObservedDays`).
 * account 행 없음은 미확인(null) → s06 comparePrevYear=false.
 * 실제 읽기 오류는 throw된다(라우트가 500으로 답한다).
 */
export function readLibraryRecap(db: Database.Database, dataDir: string): LibraryRecap {
  // 행 없음 null과 읽기 실패 throw는 account.ts가 나눈다 — 여기서 삼키지 않는다.
  const accountCreatedAt = readAccountCreatedAt(db);
  // 판정 1회 — 같은 조립 결과를 섹션 입력과 요약에 함께 쓴다(readTbti 호출 없음).
  const tbtiInput = readTbtiJudgeInput(db, dataDir);
  const tbti = judgeTbti(tbtiInput);
  const sections = computeRecapSections({
    games: tbtiInput.games,
    accountCreatedAt,
    now: tbtiInput.now,
    ownedObservedDays: tbtiInput.ownedObservedDays,
    tbti,
  });
  return assembleLibraryRecap(sections, toCardSummary(tbti));
}
