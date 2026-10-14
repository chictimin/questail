/**
 * R1.5 화면 공용 이름표 — 판정 출력(GameKey) → 표시명·커버 조인.
 * 계약 R15-3: 표시용 이름·커버는 출력에 싣지 않고 GameFacts 조인으로 해결한다.
 * 페이지는 /api/library로 읽어 이 표를 만들고, 컴포넌트는 표를 props로 받는다.
 */
import type { GameFacts } from '../../data/library.js';
import type { GameKey } from '@questail/core';
import { displayNameOf } from '../../shared/displayName.js';
import { genreDisplayName } from '../../shared/genres.js';
import type { Locale } from '../i18n/index.js';

export interface GameNameEntry {
  name: string | null;
  coverUrl: string | null;
}

/** 이름표 키 — data/recapText.ts gameKeyOf와 같은 규칙. */
export function gameMapKey(key: Pick<GameKey, 'platform' | 'externalId'>): string {
  return `${key.platform}/${key.externalId}`;
}

export type GameNameMap = Map<string, GameNameEntry>;

/** 표시명 = R1 공용 displayNameOf(ko titleKo ?? name, en name ?? titleKo) — 라이브러리와 같은 이름(F-09). */
export function buildGameMap(facts: GameFacts[], locale: Locale): GameNameMap {
  const map: GameNameMap = new Map();
  for (const factsRow of facts) {
    map.set(gameMapKey(factsRow.key), {
      name: displayNameOf(factsRow, locale),
      coverUrl: factsRow.coverUrl,
    });
  }
  return map;
}

/** 표시명 — 없으면 externalId로 둔다(recapText.ts와 같은 결정적 대체). */
export function lookupName(
  map: GameNameMap,
  key: Pick<GameKey, 'platform' | 'externalId'>,
): string {
  return map.get(gameMapKey(key))?.name ?? key.externalId;
}

export function lookupCover(
  map: GameNameMap,
  key: Pick<GameKey, 'platform' | 'externalId'>,
): string | null {
  return map.get(gameMapKey(key))?.coverUrl ?? null;
}

/**
 * 장르 표시명표 — genreId → 이름. 선택 규칙은 R1 공용
 * shared/genres.ts의 genreDisplayName을 그대로 쓴다(중복 없음).
 */
export function buildGenreMap(
  facts: GameFacts[],
  locale: Locale,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const factsRow of facts) {
    for (const genre of factsRow.genres) {
      if (!map.has(genre.genreId)) {
        const name = genreDisplayName(genre, locale);
        if (name !== null) {
          map.set(genre.genreId, name);
        }
      }
    }
  }
  return map;
}
