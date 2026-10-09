/**
 * 표시 이름 — ko면 titleKo ?? name, en이면 name ?? titleKo. 둘 다 없으면 null.
 * node·DOM import 0. ui/library/sort.ts(정렬·표시)·GameRow·server/export.ts가 함께 쓴다.
 * 서버→UI 의존 금지(GENRE-L 선례 shared/genres.ts)라 여기 둔다.
 */
import type { Locale } from '../ui/i18n/index.js';

export interface DisplayableGame {
  titleKo: string | null;
  name: string | null;
}

export function displayNameOf(
  facts: DisplayableGame,
  locale: Locale,
): string | null {
  if (locale === 'ko') {
    return facts.titleKo ?? facts.name;
  }
  return facts.name ?? facts.titleKo;
}
