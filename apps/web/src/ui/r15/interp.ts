/**
 * 리캡 01 해석 문장 키 선택 — 홈 6a와 리캡 7a가 같이 쓴다.
 * 쉬지 않고 논 일수가 1일 미만(반올림 0)이면 일수 문장을 빼고, 1일이면 단수형(en)을 쓴다.
 */
export type S01Key = 'recap.interpS01' | 'recap.interpS01OneDay' | 'recap.interpS01Short';

export function s01Key(totalMinutes: number): S01Key {
  const days = Math.round(totalMinutes / 1440);
  if (days === 0) return 'recap.interpS01Short';
  return days === 1 ? 'recap.interpS01OneDay' : 'recap.interpS01';
}

/** 봉우리 2곳(M3): games 1·2위, 동률 최근 연도 우선, 1위와 인접(±1년)이면 다음 순위. */
export function pickPeaks(years: { year: number; games: number }[]): number[] {
  const ranked = years
    .filter((entry) => entry.games > 0)
    .sort((a, b) => b.games - a.games || b.year - a.year);
  const first = ranked[0];
  if (first === undefined) return [];
  const second = ranked.find((entry) => Math.abs(entry.year - first.year) > 1);
  return second === undefined ? [first.year] : [first.year, second.year];
}
