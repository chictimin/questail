import { describe, expect, it } from 'vitest';
import type { TbtiResult } from '@questail/core';
import {
  formatCaveatCount,
  formatHours,
  formatInt,
  formatPct,
  formatPendingHours,
  formatRatioPct,
  formatStar,
  formatStarAvg,
  formatStarDev,
} from '../../src/shared/format.js';
import { renderTbtiShare } from '../../src/data/tbtiShare.js';

/**
 * W1 수치 표시 포맷(C15-5, 계약 v1.1.1 R15-11 「수치 표시 포맷」) 회귀.
 * 비정수 입력(core 원값 그대로)을 넣어 표시 형식을 단언한다 — 정수 픽스처만 쓰면
 * 원시 실수 노출(C15-1·F-01)이 테스트를 통과한다(감사 §5).
 */
describe('shared/format — 정수 반올림, 별점만 0.5 단위', () => {
  it('정수 반올림 + 천 단위 쉼표, 소수점 0', () => {
    expect(formatInt(80.35714285714286)).toBe('80');
    expect(formatInt(6795.6)).toBe('6,796');
    expect(formatInt(1234567.49)).toBe('1,234,567');
    expect(formatInt(-0.4)).toBe('0');
    expect(formatPct(19.64285714285714)).toBe('20');
    expect(formatPct(0.684931506849315)).toBe('1');
    expect(formatRatioPct(0.1357)).toBe('14');
  });

  it('분 → 시간 정수', () => {
    expect(formatHours(55314)).toBe('922');
    expect(formatHours(407760)).toBe('6,796');
    expect(formatHours(3000)).toBe('50');
  });

  it('별점 — 개별은 원값, 평균·편차는 0.5 단위 반올림', () => {
    expect(formatStar(4.5)).toBe('4.5');
    expect(formatStar(3)).toBe('3');
    expect(formatStarAvg(2.9)).toBe('3');
    expect(formatStarAvg(2.74)).toBe('2.5');
    expect(formatStarAvg(2.75)).toBe('3');
    expect(formatStarDev(2.1)).toBe('+2');
    expect(formatStarDev(-2.4)).toBe('−2.5');
    expect(formatStarDev(-2.25)).toBe('−2.5');
    expect(formatStarDev(2.25)).toBe('+2.5');
    expect(formatStarDev(-0.2)).toBe('+0');
  });

  it('caveat — n_covered_ratio만 % 정수, 나머지는 개수', () => {
    expect(formatCaveatCount('n_covered_ratio', 65.74133055071543)).toBe('66%');
    expect(formatCaveatCount('genre_unknown', 7)).toBe('7');
  });

  it('보류 진행 시간 — 내림(아직 보류인데 5 / 5시간으로 보이지 않게)', () => {
    expect(formatPendingHours(276)).toBe('4');
    expect(formatPendingHours(60)).toBe('1');
    expect(formatPendingHours(59)).toBe('0');
  });
});

function axis(
  axisNum: 1 | 2 | 3 | 4,
  primary: 'I' | 'N' | 'A' | 'C',
  primaryPct: number,
  extra?: Partial<TbtiResult['axes'][number]>,
): TbtiResult['axes'][number] {
  return {
    axis: axisNum,
    primary,
    primaryPct,
    secondary: null,
    secondaryPct: null,
    nInterval: null,
    chips: [],
    evidence: [],
    excludedCount: 0,
    held: false,
    heldReasonKey: null,
    caveats: [],
    baselineKey: null,
    baselineTextKey: null,
    metrics: null,
    ...extra,
  };
}

/** 캡틴 사본 실렌더 값(감사 F-01) — 원시 실수 그대로 넣는다. */
const RAW: TbtiResult = {
  code: 'INAC',
  axes: [
    axis(1, 'I', 80.35714285714286, { secondary: 'R', secondaryPct: 19.64285714285714 }),
    axis(2, 'N', 65.74133055071543, {
      secondary: 'H',
      secondaryPct: 13.916476848833954,
      nInterval: { min: 65.74133055071543, max: 75.86206896551724 },
    }),
    axis(3, 'A', 64.95, { secondary: 'O', secondaryPct: 35.04100629765382 }),
    axis(4, 'C', 77.5),
  ],
  pending: false,
  pendingHours: null,
  gameLetters: [],
  aliasStatus: 'missing',
  caveats: [{ code: 'observation_days', count: 4 }],
};

describe('renderTbtiShare — 비정수 원값도 정수 %로', () => {
  it('ko 축 한 줄에 소수점 0', () => {
    const text = renderTbtiShare(RAW, 'ko');
    expect(text).toContain('몰입 80% · 신작 66%(본진 비중 14%) · 잡식 65% · 파먹기 78%');
    expect(text).not.toMatch(/\d\.\d/);
  });

  it('en 축 한 줄에 소수점 0', () => {
    const text = renderTbtiShare(RAW, 'en');
    expect(text).toContain('Immersion 80% · New 66% (Home 14%) · All-rounder 65% · Completionist 78%');
    expect(text).not.toMatch(/\d\.\d/);
  });
});
