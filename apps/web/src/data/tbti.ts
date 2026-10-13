/**
 * R15-9 데이터 서비스 포트 — `readTbti(): TbtiResult`.
 * 출력 타입은 core 실타입(`packages/core/src/tbti/types.ts`, T0)을 쓴다.
 * 목업 본문은 유지한다 — T2 판정 함수 도착 시 목업 반환문을 core 호출로 교체한다(교체 지점).
 * 규칙 준수: ②축 `similar` 없음 · R22 pending 규칙
 * (pending이면 code="????"·letters 4개 "?"·mini pct=null, 비보류면 pendingHours=null).
 */
import type Database from 'better-sqlite3';
import type {
  TbtiAxis,
  TbtiCardSummary,
  TbtiResult,
} from '@questail/core';

function pendingAxis(axis: 1 | 2 | 3 | 4): TbtiAxis {
  return {
    axis,
    primary: '?',
    primaryPct: null,
    secondary: null,
    secondaryPct: null,
    // nInterval: ②축만 값, ①③④ null, pending이면 null.
    nInterval: null,
    // ②축은 `similar` 없음 — 목업 전 축 chips 비움으로 준수한다.
    chips: [],
    evidence: [],
    excludedCount: 0,
    held: true,
    heldReasonKey: 'short_sample',
    caveats: [],
    baselineKey: null,
    baselineTextKey: null,
  };
}

/**
 * TBTI 읽기 포트. 현재 목업 = 전체 보류(총 5시간 미만) 형태.
 * 교체 지점(T2): T2 판정 함수 도착 시 목업 반환문을 core 호출로 바꾼다.
 * db 인자는 포트 형태 유지용(현재 미사용) — core 입력 조립 시 쓴다.
 */
export function readTbti(_db?: Database.Database): TbtiResult {
  void _db;
  // 교체 지점(T2): `return judgeTbti(...)` (core T2) 로 교체한다.
  return {
    code: '????',
    axes: [pendingAxis(1), pendingAxis(2), pendingAxis(3), pendingAxis(4)],
    pending: true,
    pendingHours: { have: 0, need: 300 },
    caveats: [
      { code: 'observation_days', count: 0 },
      { code: 'hidden_excluded', count: 0 },
      { code: 'outside_steam_missing', count: null },
      { code: 'server_record_basis', count: null },
    ],
  };
}

/** recap 07 요약용 — readTbti 목업과 같은 보류 상태. */
export function readTbtiSummary(_db?: Database.Database): TbtiCardSummary {
  void _db;
  return {
    code: '????',
    pending: true,
    letters: ['?', '?', '?', '?'],
    mini: [
      { axis: 1, pct: null },
      { axis: 2, pct: null },
      { axis: 3, pct: null },
      { axis: 4, pct: null },
    ],
  };
}
