/** 정렬 상태 전이 — 순수 함수. 저장값 복원(PUT 없음)과 사용자 조작 결과를 분리한다. */
import type { Prefs } from '../../data/viewState.js';
import type { FilterKey } from './filter.js';
import {
  SORT_KEYS,
  defaultDirectionOf,
  type Direction,
  type SortKey,
  type SortSpec,
} from './sort.js';

export function defaultSort(filterKey: FilterKey): SortSpec {
  if (filterKey === 'byRating') {
    return { sortKey: 'ratedAt', direction: 'desc' };
  }
  return { sortKey: 'playtime', direction: 'desc' };
}

export function isSortKey(value: string): value is SortKey {
  return (SORT_KEYS as string[]).includes(value);
}

/** 저장값 복원 — 저장된 방향을 그대로 쓰고, 어휘 밖이면 필터 기본값. */
export function rememberedSort(
  prefs: Prefs | null,
  filterKey: FilterKey,
): SortSpec {
  const entry = prefs?.sortPerFilter.find((row) => row.filterKey === filterKey);
  if (
    entry !== undefined &&
    isSortKey(entry.sortKey) &&
    (entry.direction === 'asc' || entry.direction === 'desc')
  ) {
    return { sortKey: entry.sortKey, direction: entry.direction };
  }
  return defaultSort(filterKey);
}

/** 사용자가 기준을 바꿨을 때 — 그 키의 기본 방향. */
export function sortAfterKeyChange(sortKey: SortKey): SortSpec {
  return { sortKey, direction: defaultDirectionOf(sortKey) };
}

export function flipDirection(direction: Direction): Direction {
  return direction === 'asc' ? 'desc' : 'asc';
}

/** 사용자가 방향 버튼을 눌렀을 때 — 같은 키, 반대 방향. */
export function sortAfterDirectionToggle(spec: SortSpec): SortSpec {
  return { sortKey: spec.sortKey, direction: flipDirection(spec.direction) };
}

/**
 * load 응답 prefs 시퀀스 가드 — load 시작 이후 사용자 PUT이 있었으면 그 응답의 prefs는 쓰지 않는다.
 * 먼저 시작한 GET의 옛 값이 성공한 PUT 뒤 화면값을 되돌리는 경로를 막는다.
 */
export function createPrefsWriteGuard(): {
  begin: () => number;
  noteWrite: () => void;
  isStale: (token: number) => boolean;
} {
  let writes = 0;
  return {
    begin: () => writes,
    noteWrite: () => {
      writes += 1;
    },
    isStale: (token) => token !== writes,
  };
}

/**
 * 재조회 요청 시퀀스 — busy는 최신 요청 기준으로만 켜고 끈다.
 * 오래된 요청의 완료는 새 요청의 busy를 끄지 않고, 새 요청 시작은 오래된 요청의 해제를 기다리지 않는다.
 */
export function createLoadSequence(): {
  begin: (inPlace: boolean) => number;
  isLatest: (token: number) => boolean;
  settle: (token: number) => void;
  isBusy: () => boolean;
  current: () => number;
} {
  let latest = 0;
  let busy = false;
  return {
    begin: (inPlace) => {
      latest += 1;
      busy = inPlace;
      return latest;
    },
    isLatest: (token) => token === latest,
    settle: (token) => {
      if (token === latest) busy = false;
    },
    isBusy: () => busy,
    current: () => latest,
  };
}

/** 스켈레톤 전 저장한 scrollTop을 새 리스트 크기에 맞춰 복원값으로 — 행이 줄었으면 최대값으로 절삭. */
export function clampScrollTop(
  saved: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  return Math.max(0, Math.min(saved, scrollHeight - clientHeight));
}
