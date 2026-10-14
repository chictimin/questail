import { describe, expect, it } from 'vitest';
import { pickPeaks, s01Key } from '../../src/ui/r15/interp.js';
import { lastCollectedAt } from '../../src/ui/shell/SummaryPill.js';

/** W5·W6 해석 템플릿 선택 규칙(계약 v1.1.2 R15-11 M3) + 셸 수집 칩(F-37). */
describe('06 봉우리(M3)', () => {
  it('1·2위 연도', () => {
    expect(pickPeaks([
      { year: 2013, games: 11 },
      { year: 2018, games: 7 },
      { year: 2025, games: 13 },
    ])).toEqual([2025, 2013]);
  });

  it('동률이면 최근 연도 우선', () => {
    expect(pickPeaks([
      { year: 2010, games: 5 },
      { year: 2020, games: 5 },
      { year: 2015, games: 3 },
    ])).toEqual([2020, 2010]);
  });

  it('1위와 인접(±1년)이면 다음 순위', () => {
    expect(pickPeaks([
      { year: 2024, games: 9 },
      { year: 2025, games: 10 },
      { year: 2013, games: 4 },
    ])).toEqual([2025, 2013]);
  });

  it('0개 연도는 봉우리가 아니다 · 하나뿐이면 1곳', () => {
    expect(pickPeaks([{ year: 2020, games: 2 }, { year: 2021, games: 0 }])).toEqual([2020]);
    expect(pickPeaks([])).toEqual([]);
  });
});

describe('01 해석 문장 키', () => {
  it('하루 미만은 일수 문장 생략, 1일은 단수형', () => {
    expect(s01Key(600)).toBe('recap.interpS01Short');
    expect(s01Key(1440)).toBe('recap.interpS01OneDay');
    expect(s01Key(407760)).toBe('recap.interpS01');
  });
});

describe('셸 수집 칩 — 마지막 수집 시각', () => {
  it('소스 lastFinishedAt 최댓값, 없으면 null', () => {
    const entry = (lastFinishedAt: number | null) =>
      ({
        source: 'owned',
        state: 'ok',
        runId: 1,
        generation: 1,
        lastFinishedAt,
        progress: { done: 0, total: null, source: 'owned' },
        issue: null,
      }) as const;
    expect(lastCollectedAt([entry(100), entry(300), entry(null)])).toBe(300);
    expect(lastCollectedAt([entry(null)])).toBeNull();
    expect(lastCollectedAt(null)).toBeNull();
  });
});
