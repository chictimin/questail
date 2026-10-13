/**
 * T3 시리즈 판별 — 정규화 파이프라인 (계약 R15-6, 동결 v1.0).
 * 순서 고정: ① 소문자화 → ② 에디션 꼬리 제거(반복) → ③ 숫자 통일 → ④ 코어 추출. 순서 변경 금지.
 * DB·FS·HTTP·Date·Random·apps/web import 0.
 */

/** R15-10 「② H 경계」(값 30%, 확정 N1) — 판정은 T2 몫, 중앙 tbti/constants.ts가 정본. 여기서는 주석으로만 참조한다. */

/**
 * R15-6 「같은 묶음 2작 이상이면 H 근거」(확정).
 * T2가 H 근거로 인정하는 최소 묶음 크기.
 */
export const SERIES_MIN_BUNDLE_SIZE = 2;

/**
 * 부록 A 「내장 기본 별칭」(제안, 소수 generic) — seriesAliases.status='missing'일 때만 사용.
 * 키는 ③ 숫자 통일 후 정규화명, 값은 시리즈ID.
 */
export const SERIES_BUILTIN_ALIASES: Readonly<Record<string, string>> = {
  'biohazard': 'resident-evil',
  'resident evil': 'resident-evil',
  'monster hunter': 'monster-hunter',
  'dark souls': 'dark-souls',
  'the witcher': 'the-witcher',
  'final fantasy': 'final-fantasy',
};

/**
 * R15-6 「에디션 꼬리 목록」(확정, 판정 반영 — 7종, 대소문자 무시, 후치 절단).
 * 비교는 ① 후 소문자 상태에서 한다.
 */
export const SERIES_EDITION_TAILS: readonly string[] = [
  'game of the year edition',
  'definitive edition',
  'complete edition',
  'deluxe edition',
  "director's cut",
  'remastered',
  'remake',
];

/**
 * R15-6 「숫자 통일 규칙」(확정 N5) — 로마숫자 I~X만 통일(II→2 등), XI~ 통일 안 함.
 * 인덱스 = 아라비아 값. 0번("O" 오탐 방지용 자리) 미사용.
 */
export const SERIES_ROMAN_I_TO_X: readonly string[] = [
  '', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x',
];

/**
 * R15-6 「시리즈 코어 추출」(확정 N5) — 첫 번째 구분자 앞부분 전체(trim).
 * 구분자 `: ,  - ,  ( , –(en dash), 전후 공백 변형(R14)`(계약 236행 — 콤마 없음).
 * 하이픈은 단어 내 결합(Souls-like 등) 보호를 위해 양옆 공백 필수.
 */
export const SERIES_CORE_SEPARATOR_PATTERN = /:|\s+-\s+|\(|–/;

/**
 * R15-6 「개발사 보조」(확정 N5 — 보조만) — 개발사 정규화 시 단어 경계에서 제거하는 접미어.
 * Co 부분일치 금지 → 전부 단어 단위 정확 일치로만 제거한다.
 */
export const SERIES_DEV_SUFFIX_WORDS: readonly string[] = [
  'inc', 'llc', 'co', 'gmbh', 'studio', 'studios',
];

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** ① 소문자화. */
export function seriesLower(raw: string): string {
  return collapseSpaces(raw.toLowerCase());
}

/** ② 에디션 꼬리 제거(반복 적용 — "Deluxe Remastered"는 둘 다 제거, R14). 꼬리만 남은 경우(빈 문자열)는 자르지 않는다. */
export function seriesStripEditionTails(lowered: string): string {
  // 긴 꼬리 우선(같은 접미 공유 대비).
  const tails = [...SERIES_EDITION_TAILS].sort((a, b) => b.length - a.length);
  let cur = collapseSpaces(lowered);
  for (;;) {
    let cut = false;
    for (const tail of tails) {
      if (cur === tail) break;
      if (cur.endsWith(tail)) {
        const head = collapseSpaces(cur.slice(0, cur.length - tail.length));
        // 단어 경계에서 잘려야 한다("some remake-x" 보호).
        const boundaryOk =
          cur.length > tail.length && /[\s:,\-(–]/.test(cur[cur.length - tail.length - 1] ?? '');
        if (head.length > 0 && boundaryOk) {
          cur = head;
          cut = true;
          break;
        }
      }
    }
    if (!cut) return cur;
  }
}

function romanToArabic(token: string): string | null {
  const idx = SERIES_ROMAN_I_TO_X.indexOf(token);
  return idx >= 1 ? String(idx) : null;
}

/**
 * ③ 숫자 통일(확정 N5).
 * - 로마 I~X 토큰 → 아라비아(XI~ 제외 — 토큰 전체 일치만 치환하므로 자동 제외).
 * - "Part N"·접미 " N" 동일 처리: "part" + (로마 I~X | 1~3자리 숫자) → 숫자만 남긴다.
 * - 4자리 숫자(연도·고유번호, 예: Battlefield 2042)는 통일 제외.
 */
export function seriesUnifyNumbers(stripped: string): string {
  // "part <로마|숫자>" → 숫자. 4자리 숫자의 part는 손대지 않는다.
  const partDropped = stripped.replace(
    /\bpart\s+([ivxlcdm]+|\d+)\b/g,
    (m, n: string) => {
      const lower = String(n).toLowerCase();
      if (/^\d+$/.test(lower)) {
        return lower.length === 4 ? m : ` ${lower} `;
      }
      const arabic = romanToArabic(lower);
      return arabic !== null ? ` ${arabic} ` : m;
    },
  );
  // 독립 로마 토큰 I~X → 아라비아. XI~는 매칭 자체가 안 된다.
  const unified = partDropped.replace(
    /\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/g,
    (m) => romanToArabic(m) ?? m,
  );
  return collapseSpaces(unified);
}

/** ④ 시리즈 코어 추출 — 첫 구분자 앞부분 전체. 코어가 비면 정규화명 전체를 쓴다. */
export function seriesExtractCore(unified: string): string {
  const m = SERIES_CORE_SEPARATOR_PATTERN.exec(unified);
  if (!m || m.index === undefined) return unified;
  const head = collapseSpaces(unified.slice(0, m.index));
  return head.length > 0 ? head : unified;
}

/** 파이프라인 전체 ①→②→③→④. */
export function normalizeSeriesTitle(raw: string): { normalized: string; core: string } {
  const lowered = seriesLower(raw);
  const stripped = seriesStripEditionTails(lowered);
  const normalized = seriesUnifyNumbers(stripped);
  const core = seriesExtractCore(normalized);
  return { normalized, core };
}

/**
 * 개발사 정규화(R15-6 개발사 보조, 확정 N5 — R14 단어 경계, Co 부분일치 금지).
 * 소문자 → 단어 분리 → 접미어 단어 제거 → 재결합. null·빈값은 null.
 */
export function normalizeSeriesDeveloper(dev: string | null): string | null {
  if (dev === null) return null;
  const tokens = dev
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !SERIES_DEV_SUFFIX_WORDS.includes(t));
  if (tokens.length === 0) return null;
  return tokens.join(' ');
}

/** 별칭 맵 키 정규화 — 계약상 키는 이미 정규화명이나, 파일 저자 표기 편차(대소문자·공백)만 흡수한다. */
export function normalizeAliasKey(key: string): string {
  return collapseSpaces(key.toLowerCase());
}
