/**
 * R15-9 데이터 서비스 포트 — `readTbti(db, dataDir): TbtiResult`.
 * 판정 본체는 core 실함수 T2(`judgeTbti`, `packages/core/src/tbti/judge.ts`)를 호출한다.
 * 출력 타입도 core 실타입(`packages/core/src/tbti/types.ts`, T0)이다.
 * 규칙 준수: ②축 `similar` 없음 · R22 pending 규칙 — core가 보장한다.
 */
import type Database from 'better-sqlite3';
import { judgeTbti, type TbtiJudgeInput, type TbtiResult } from '@questail/core';
import { listGameFacts } from './archiveRead.js';
import { loadSeriesAliases } from './seriesAliases.js';
import { readOwnedObservedDays } from './syncRuns.js';
import { getPrefs } from './viewState.js';

/**
 * T2 판정 입력 조립 — recap 집계와 /api/tbti가 같은 조립을 쓴다(판정 1회 원칙의 한쪽).
 * games = `listGameFacts` hidden 포함 원본(core 내부 제외 R15-2 ①),
 * wishlistEnabled = Prefs tbtiWishlist, now = epoch 초,
 * ownedObservedDays = `readOwnedObservedDays`(R20·계약 v1.0.2),
 * seriesAliases = `loadSeriesAliases` 반환 그대로.
 */
export function readTbtiJudgeInput(db: Database.Database, dataDir: string): TbtiJudgeInput {
  return {
    games: listGameFacts(db),
    wishlistEnabled: getPrefs(db, 'ko').tbtiWishlist,
    now: Math.floor(Date.now() / 1000),
    ownedObservedDays: readOwnedObservedDays(db),
    seriesAliases: loadSeriesAliases(dataDir),
  };
}

/** TBTI 읽기 포트 — 입력 조립 후 `judgeTbti` 1회 호출이다. */
export function readTbti(db: Database.Database, dataDir: string): TbtiResult {
  return judgeTbti(readTbtiJudgeInput(db, dataDir));
}
