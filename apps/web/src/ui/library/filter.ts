/**
 * W7 클라이언트 필터 — 순수 함수. RATE-2 필터 4종 + pimo 유지 규칙.
 * hidden 필터가 아니면 숨긴 항목을 제외한다. keep은 "방금 매김" 유지 키 집합이다.
 */
import type { GameFacts } from '../../data/library.js';
import type { GameKey } from '../../data/ratings.js';

export type FilterKey = 'all' | 'unrated' | 'byRating' | 'hidden';

export interface FilterSpec {
  key: FilterKey;
  /** 별점별 칩 값 — 저장 단위 1~10 정수. */
  score?: number | null;
  /** 필터에서 빠져도 유지할 게임 키 집합. `${platform}/${externalId}`. */
  keep?: readonly string[];
}

interface KeyedGame {
  key: GameKey;
}

export function filterKeyOf(facts: KeyedGame): string {
  return `${facts.key.platform}/${facts.key.externalId}`;
}

export function filterGames(games: GameFacts[], spec: FilterSpec): GameFacts[] {
  return games.filter((facts) => {
    if (spec.key === 'hidden') {
      return facts.hidden;
    }
    if (facts.hidden) {
      return false;
    }
    if (spec.keep !== undefined && spec.keep.includes(filterKeyOf(facts))) {
      return true;
    }
    switch (spec.key) {
      case 'all':
        return true;
      case 'unrated':
        // 미평가는 score null이다. 0점으로 다루지 않는다.
        return facts.latestScore === null;
      case 'byRating':
        // 칩 미선택(전체 칩) = 매긴 게임 전부.
        if (spec.score === undefined || spec.score === null) {
          return facts.latestScore !== null;
        }
        return facts.latestScore === spec.score;
    }
  });
}
