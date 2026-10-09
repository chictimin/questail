/**
 * GENRE-L 장르 표시 선택 — 순수. node·DOM import 0.
 * server/export.ts와 ui/library/GameRow.tsx가 함께 쓴다.
 * ko 화면 nameKo ?? nameEn, en 화면 nameEn ?? nameKo, 둘 다 없으면 null(생략).
 * 지금 타입은 nameEn: string이라 ?? 는 무해하고, 데이터 nullable 전환 뒤 그대로 맞물린다.
 */
import type { Locale } from '../ui/i18n/index.js';

export interface GenreName {
  nameKo: string | null;
  nameEn: string | null;
}

export function genreDisplayName(genre: GenreName, locale: Locale): string | null {
  if (locale === 'ko') {
    return genre.nameKo ?? genre.nameEn;
  }
  return genre.nameEn ?? genre.nameKo;
}

/** 표시명 목록 — null(둘 다 없음)은 뺀다. */
export function genreDisplayNames(
  genres: readonly GenreName[],
  locale: Locale,
): string[] {
  const out: string[] = [];
  for (const genre of genres) {
    const name = genreDisplayName(genre, locale);
    if (name !== null) {
      out.push(name);
    }
  }
  return out;
}

/**
 * 내보내기용 — locale 무관 nameEn ?? nameKo, 둘 다 없으면 생략(PM #84915).
 * frontmatter 영문 고정 키의 값 손실 방지.
 */
export function genreExportNames(genres: readonly GenreName[]): string[] {
  const out: string[] = [];
  for (const genre of genres) {
    const name = genre.nameEn ?? genre.nameKo;
    if (name !== null) {
      out.push(name);
    }
  }
  return out;
}
