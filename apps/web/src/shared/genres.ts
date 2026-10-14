/**
 * GENRE-L 장르 표시 선택 — 순수. node·DOM import 0.
 * server/export.ts·ui/library/GameRow.tsx·R1.5 화면(ui/r15/names.ts)·서버 텍스트 렌더가 함께 쓴다.
 * ko 화면 nameKo ?? nameEn ?? 고정표 영문, en 화면 nameEn ?? 고정표 영문 ?? "Other genre"(사전).
 * 이름이 하나도 없으면 null(생략). en에 한국어 장르가 나오지 않는다(R1.5 DoD 다국어1, F-09).
 */
import { t, type Locale } from '../ui/i18n/index.js';

export interface GenreName {
  /** Steam 장르 ID. 있으면 nameEn이 없을 때 고정표로 영문 이름을 찾는다. */
  genreId?: string;
  nameKo: string | null;
  nameEn: string | null;
}

/**
 * Steam 장르 ID → 영문 이름 고정표. ko로만 수집한 사용자는 genre_name_en이 전부 NULL이라
 * en 화면에 쓸 이름이 없다(캡틴 사본 10종 전부 NULL, 2026-10-14).
 * 출처: Steam store appdetails `genres[].id`. ID 의미는 캡틴 사본 game_genres의 실수집
 * ko 이름으로 확인한 10종만 싣는다(확인 2026-10-14: 1 액션 · 2 전략 · 3 RPG · 4 캐주얼 ·
 * 9 레이싱 · 18 스포츠 · 23 인디 · 25 어드벤처 · 28 시뮬레이션 · 29 대규모 멀티플레이어).
 * 확인 안 된 ID는 넣지 않는다 — en에서 "Other genre"로 나온다.
 */
const STEAM_GENRE_EN: Readonly<Record<string, string>> = {
  '1': 'Action',
  '2': 'Strategy',
  '3': 'RPG',
  '4': 'Casual',
  '9': 'Racing',
  '18': 'Sports',
  '23': 'Indie',
  '25': 'Adventure',
  '28': 'Simulation',
  '29': 'Massively Multiplayer',
};

function tableEn(genre: GenreName): string | null {
  return genre.genreId !== undefined ? (STEAM_GENRE_EN[genre.genreId] ?? null) : null;
}

export function genreDisplayName(genre: GenreName, locale: Locale): string | null {
  if (locale === 'ko') {
    return genre.nameKo ?? genre.nameEn ?? tableEn(genre);
  }
  if (genre.nameEn !== null) {
    return genre.nameEn;
  }
  const fromTable = tableEn(genre);
  if (fromTable !== null) {
    return fromTable;
  }
  return genre.nameKo !== null ? t(locale, 'library.genreOther') : null;
}

/**
 * en 이름이 있는가(nameEn 또는 고정표) — 서버 텍스트처럼 "Other genre"를 늘어놓을 자리가
 * 아닌 곳에서 en 항목을 거를 때 쓴다.
 */
export function hasEnglishGenreName(genre: GenreName): boolean {
  return genre.nameEn !== null || tableEn(genre) !== null;
}

/** 표시명 목록 — null(이름 없음)은 뺀다. */
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
 * 내보내기용 — locale 무관 nameEn ?? 고정표 영문 ?? nameKo, 모두 없으면 생략(PM #84915).
 * frontmatter 영문 고정 키의 값 손실 방지.
 */
export function genreExportNames(genres: readonly GenreName[]): string[] {
  const out: string[] = [];
  for (const genre of genres) {
    const name = genre.nameEn ?? tableEn(genre) ?? genre.nameKo;
    if (name !== null) {
      out.push(name);
    }
  }
  return out;
}
