/**
 * W9/W7 공용 — 현재 점수가 된 최신 실변경 at. 미평가면 null이다.
 * node·DOM import 0. server/export.ts와 ui/library/sort.ts가 함께 쓴다.
 * rating 행과 마지막 events 행의 after가 항상 일치하므로
 * "after가 현재 점수와 같은 행 중 최대 at"은 최신 실변경과 같은 값이다.
 */
export interface RatedInput {
  latestScore: number | null;
  ratingEvents: { after: number | null; at: number }[];
}

export function latestRatedAt(facts: RatedInput): number | null {
  if (facts.latestScore === null) return null;
  let latest: number | null = null;
  for (const event of facts.ratingEvents) {
    if (
      event.after === facts.latestScore &&
      (latest === null || event.at > latest)
    ) {
      latest = event.at;
    }
  }
  return latest;
}
