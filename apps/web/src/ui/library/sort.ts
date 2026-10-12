/**
 * W7 클라이언트 정렬 — 순수 함수. C-2a 필드 · RATE-2 규칙 · P-4 이름 규칙.
 * 값 없음은 방향과 무관하게 맨 뒤 → 값 비교 → 표시 이름 2차(Collator)
 * → externalId 숫자 오름차순 → platform 문자열 (결정적 순서).
 */
import type { GameFacts } from '../../data/library.js';
import { latestRatedAt } from '../../shared/ratedAt.js';
import { displayNameOf } from '../../shared/displayName.js';
import type { Locale } from '../i18n/index.js';

/** P-4 반영 입력 — name이 null일 수 있다(D-04 착지 전에는 발동 안 함). */
export type SortableGame = Omit<GameFacts, 'name'> & { name: string | null };

export type SortKey =
  | 'playtime'
  | 'lastPlayed'
  | 'rating'
  | 'ratedAt'
  | 'addedAt'
  | 'releaseDate'
  | 'name';
export type Direction = 'asc' | 'desc';
export interface SortSpec {
  sortKey: SortKey;
  direction: Direction;
}

/** 14조합 — 서버 어휘와 같은 7키 × 2방향. 키별 첫 항목이 그 키의 기본 방향이다. */
export const SORT_OPTIONS: SortSpec[] = [
  { sortKey: 'playtime', direction: 'desc' },
  { sortKey: 'playtime', direction: 'asc' },
  { sortKey: 'lastPlayed', direction: 'desc' },
  { sortKey: 'lastPlayed', direction: 'asc' },
  { sortKey: 'rating', direction: 'desc' },
  { sortKey: 'rating', direction: 'asc' },
  { sortKey: 'ratedAt', direction: 'desc' },
  { sortKey: 'ratedAt', direction: 'asc' },
  { sortKey: 'addedAt', direction: 'desc' },
  { sortKey: 'addedAt', direction: 'asc' },
  { sortKey: 'releaseDate', direction: 'desc' },
  { sortKey: 'releaseDate', direction: 'asc' },
  { sortKey: 'name', direction: 'asc' },
  { sortKey: 'name', direction: 'desc' },
];

/** 정렬 기준 선택 표시 순서(SORT_OPTIONS 키 등장 순). */
export const SORT_KEYS: SortKey[] = [
  'playtime',
  'lastPlayed',
  'rating',
  'ratedAt',
  'addedAt',
  'releaseDate',
  'name',
];

/** 키 전환 시 방향 — SORT_OPTIONS에서 그 키의 첫 방향. */
export function defaultDirectionOf(sortKey: SortKey): Direction {
  const first = SORT_OPTIONS.find((option) => option.sortKey === sortKey);
  return first === undefined ? 'desc' : first.direction;
}

/**
 * 표시 이름은 shared/displayName.ts 1곳에만 있다(서버→UI 의존 금지).
 * 정렬·표시가 같은 함수를 써서 en 정렬도 같이 바뀐다. 정렬 키가 아니다.
 */

/**
 * 현재 점수가 된 최신 실변경 at. 미평가면 null.
 * 정의는 shared/ratedAt.ts 1곳에만 있다(server/export.ts와 공유).
 */
export function ratedAtOf(facts: SortableGame): number | null {
  return latestRatedAt(facts);
}

function primaryOf(
  facts: SortableGame,
  locale: Locale,
  sortKey: SortKey,
): number | string | null {
  switch (sortKey) {
    case 'playtime':
      return facts.confirmedMinutes;
    case 'lastPlayed':
      return facts.lastPlayed;
    case 'rating':
      return facts.latestScore;
    case 'ratedAt':
      return ratedAtOf(facts);
    case 'addedAt':
      return facts.libraryAddedAt;
    case 'releaseDate':
      return facts.releaseDate;
    case 'name':
      return displayNameOf(facts, locale);
  }
}

/** externalId 숫자 오름차순. 숫자 비교 불가면 문자열 비교(결정적). */
function compareExternalId(a: string, b: string): number {
  const numericA = a.trim() !== '' ? Number(a) : NaN;
  const numericB = b.trim() !== '' ? Number(b) : NaN;
  if (Number.isFinite(numericA) && Number.isFinite(numericB)) {
    return numericA - numericB;
  }
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function comparePlatform(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function compareGames(
  locale: Locale,
  spec: SortSpec,
): (a: SortableGame, b: SortableGame) => number {
  const collator = new Intl.Collator(locale);
  return (a, b) => {
    const primaryA = primaryOf(a, locale, spec.sortKey);
    const primaryB = primaryOf(b, locale, spec.sortKey);
    if (primaryA === null || primaryB === null) {
      if (primaryA === null && primaryB === null) {
        return compareExternalId(a.key.externalId, b.key.externalId);
      }
      // 값 없음은 방향과 무관하게 맨 뒤
      return primaryA === null ? 1 : -1;
    }
    if (spec.sortKey === 'name') {
      const compared =
        spec.direction === 'asc'
          ? collator.compare(primaryA as string, primaryB as string)
          : -collator.compare(primaryA as string, primaryB as string);
      if (compared !== 0) return compared;
    } else {
      const diff = (primaryA as number) - (primaryB as number);
      if (diff !== 0) return spec.direction === 'asc' ? diff : -diff;
    }
    const nameA = displayNameOf(a, locale);
    const nameB = displayNameOf(b, locale);
    if (nameA === null || nameB === null) {
      if (nameA === null && nameB === null) {
        return compareExternalId(a.key.externalId, b.key.externalId);
      }
      return nameA === null ? 1 : -1;
    }
    const byName = collator.compare(nameA, nameB);
    if (byName !== 0) return byName;
    const byId = compareExternalId(a.key.externalId, b.key.externalId);
    if (byId !== 0) return byId;
    return comparePlatform(a.key.platform, b.key.platform);
  };
}

/** 복사 후 정렬한다(입력 배열 불변). */
export function sortGames(
  games: SortableGame[],
  locale: Locale,
  spec: SortSpec,
): SortableGame[] {
  return [...games].sort(compareGames(locale, spec));
}
