/**
 * R15-9 데이터 서비스 포트 — `readLibraryRecap(): LibraryRecap`.
 * 출력 타입은 core 실타입(`packages/core/src/recap/types.ts`, T0)을 쓴다.
 * 목업 본문은 유지한다 — T1 집계 함수 도착 시 목업 반환문을 core 호출로 교체한다(교체 지점).
 */
import type Database from 'better-sqlite3';
import type { LibraryRecap } from '@questail/core';
import { readTbtiSummary } from './tbti.js';

/**
 * 전체 recap 읽기 포트. 현재 목업 = 빈 라이브러리 형태.
 * 교체 지점(T1): T1 집계 함수 도착 시 목업 반환문을 core 호출로 바꾼다.
 * db 인자는 포트 형태 유지용(현재 미사용) — core 입력 조립 시 쓴다.
 */
export function readLibraryRecap(_db?: Database.Database): LibraryRecap {
  void _db;
  // 교체 지점(T1): `return aggregateLibraryRecap(...)` (core T1) 로 교체한다.
  const nowYear = new Date().getUTCFullYear();
  return {
    basis: { observedDays: 0, firstObservedAt: null },
    s01: { caveats: [], totalMinutes: 0, top5: [] },
    s02: { caveats: [], knownGames: 0, bars: [] },
    s03: {
      caveats: [],
      owned: 0,
      played: 0,
      buckets: [
        { code: 'lt2h', games: 0 },
        { code: 'h2_10', games: 0 },
        { code: 'h10_30', games: 0 },
        { code: 'h30_100', games: 0 },
        { code: 'gte100h', games: 0 },
      ],
      unplayedKeys: [],
      missingKeys: [],
    },
    s04: {
      caveats: [],
      ratedCount: 0,
      mean: null,
      dist10: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      high: [],
      low: [],
    },
    s05: {
      caveats: [],
      bands: [
        { code: 'new', fromYear: nowYear, toYear: nowYear, games: 0 },
        { code: 'recent', fromYear: nowYear - 7, toYear: nowYear - 1, games: 0 },
        { code: 'classic', fromYear: null, toYear: nowYear - 8, games: 0 },
      ],
    },
    s06: { caveats: [], years: [], comparePrevYear: false },
    tbti: readTbtiSummary(),
  };
}
