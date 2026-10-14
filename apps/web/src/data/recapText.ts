/**
 * S3 리캡 텍스트 렌더 — 컨셉 노트 A-8 형식(TBTI 줄 `- TBTI: {호칭} ({코드})` 포함).
 * 숫자는 전부 예시값이 아니라 집계 실값이다. 문구는 서버 i18n 사전으로 렌더한다.
 * 게임명·장르명은 호출 측이 GameFacts 실값에서 묶어 넘긴다(게임 이름 인자와 같은 방식).
 * 장르 표시 선택은 R1 공용 `genreDisplayNames`를 그대로 호출한다(자체 대체 규칙 없음).
 * 이름표에 없는 장르는 줄에서 뺀다 — 장르 ID가 사용자 텍스트에 나오면 결함이다.
 * en에는 영문 이름(nameEn 또는 Steam ID 고정표)이 없는 항목을 입력에서 뺀다.
 *
 * 가정(리뷰에서 확정):
 * - 수치 표시는 shared/format.ts(C15-5): 시간 정수 반올림 + 천 단위 쉼표, 별점 평균 0.5 단위.
 * - 장르 줄은 상위 3개만.
 * - 미평가면 개수 줄만.
 * - 빈 top5·장르는 줄 생략. en TBTI 줄은 코드만(PM #109421 — 한국어 본문 제외).
 * - 내보내기 파일명 'recap.md'(가정). 복사 텍스트는 끝개행 없음, 파일은 끝개행 1개(export.ts 선례).
 */
import type { GameFacts, LibraryRecap } from '@questail/core';
import type { ExportFile } from '../server/export.js';
import { displayNameOf } from '../shared/displayName.js';
import { formatHours, formatStarAvg } from '../shared/format.js';
import {
  genreDisplayNames,
  hasEnglishGenreName,
  type GenreName,
} from '../shared/genres.js';
import { t, type Locale } from '../ui/i18n/index.js';
import { TBTI_NAMES, type TbtiCode } from './tbtiNames.js';

/** 게임명표 — 키 `${platform}/${externalId}` → 표시명. */
export type RecapGameNames = Map<string, string>;

/** 장르표 — genreId → 이름 쌍. 표시 선택은 `genreDisplayNames` 몫이다. */
export type RecapGenreNames = Map<string, GenreName>;

function gameKeyOf(key: { platform: string; externalId: string }): string {
  return `${key.platform}/${key.externalId}`;
}

/**
 * 이름표 조립 — GameFacts 실값 묶음이다.
 * 게임명: displayNameOf와 같은 대체(ko titleKo ?? name, en name ?? titleKo).
 * 장르: 이름 쌍 그대로 싣는다(선택은 렌더 시 `genreDisplayNames`가 한다).
 */
export function recapNameTables(
  games: GameFacts[],
  locale: Locale,
): { names: RecapGameNames; genreNames: RecapGenreNames } {
  const names: RecapGameNames = new Map();
  const genreNames: RecapGenreNames = new Map();
  for (const game of games) {
    const name = displayNameOf(game, locale);
    if (name !== null) {
      names.set(gameKeyOf(game.key), name);
    }
    for (const genre of game.genres) {
      if (!genreNames.has(genre.genreId)) {
        genreNames.set(genre.genreId, {
          genreId: genre.genreId,
          nameKo: genre.nameKo,
          nameEn: genre.nameEn,
        });
      }
    }
  }
  return { names, genreNames };
}

/**
 * A-8 복사 텍스트. 이름표에 없는 게임은 externalId로 둔다(결정적 대체).
 * 장르 줄은 이름표에 있는 상위 3개만 싣고, 하나도 없으면 줄을 생략한다.
 * 예시(ko): A-8 블록 그대로 — 헤더 · 누적 · 상위 5 · 장르 · 별점 · TBTI 줄 · 각주.
 */
export function renderRecapText(
  recap: LibraryRecap,
  locale: Locale,
  names?: RecapGameNames,
  genreNames?: RecapGenreNames,
): string {
  const lines = [
    `${t(locale, 'recap.title')} ${t(locale, 'recap.basis', { days: recap.basis.observedDays })}`,
    t(locale, 'recap.total', {
      hours: formatHours(recap.s01.totalMinutes),
      owned: recap.s03.owned,
      played: recap.s03.played,
    }),
  ];
  if (recap.s01.top5.length > 0) {
    const entries = recap.s01.top5.map((row) => {
      const name = names?.get(gameKeyOf(row.key)) ?? row.key.externalId;
      return `${name} ${formatHours(row.minutes)}h`;
    });
    lines.push(t(locale, 'recap.top5', { list: entries.join(' · ') }));
  }
  const genreEntries = recap.s02.bars
    .slice(0, 3)
    .map((bar) => genreNames?.get(bar.genreId))
    .filter((entry): entry is GenreName => entry !== undefined);
  // en에는 영문 이름(nameEn 또는 Steam ID 고정표)이 있는 항목만 싣는다 —
  // 한국어도, 뜻 없는 "Other genre" 나열도 나오지 않게.
  const displayable =
    locale === 'en' ? genreEntries.filter(hasEnglishGenreName) : genreEntries;
  const topGenres = genreDisplayNames(displayable, locale);
  if (topGenres.length > 0) {
    const list = topGenres.join(' · ');
    lines.push(t(locale, 'recap.genres', { list, josa: subjectJosa(list) }));
  }
  lines.push(
    recap.s04.ratedCount > 0 && recap.s04.mean !== null
      ? t(locale, 'recap.rating', {
          n: recap.s04.ratedCount,
          mean: formatStarAvg(recap.s04.mean),
        })
      : t(locale, 'recap.ratingNone'),
  );
  if (locale === 'ko') {
    const entry =
      !recap.tbti.pending && isTbtiCode(recap.tbti.code)
        ? TBTI_NAMES[recap.tbti.code].ko.title
        : null;
    lines.push(
      entry !== null
        ? t(locale, 'recap.tbtiTail', { title: entry, code: recap.tbti.code })
        : t(locale, 'recap.tbtiPending'),
    );
  } else {
    lines.push(t(locale, 'recap.tbtiTail', { code: recap.tbti.code }));
  }
  lines.push(t(locale, 'recap.footing'));
  return lines.join('\n');
}

/**
 * 주격 조사 — 끝 글자가 받침 있는 한글이면 '이', 그 밖(받침 없음·영문 등)은 '가'(F-34).
 * ko 템플릿만 {josa}를 쓰고 en 템플릿은 무시한다.
 */
function subjectJosa(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) {
    return (last - 0xac00) % 28 === 0 ? '가' : '이';
  }
  return '가';
}

function isTbtiCode(code: string): code is TbtiCode {
  return code in TBTI_NAMES;
}

/** 내보내기 recap 파일명 — 게임 파일(`{platform}-{external_id}.md`)과 겹치지 않는다(가정). */
export const RECAP_EXPORT_FILENAME = 'recap.md';

/**
 * Markdown 내보내기 recap 1종. frontmatter 키 영문 고정(export.ts 선례).
 * 시각 값은 전부 데이터 실값이라 픽스처 대조가 결정적이다(생성 시각 키 없음).
 */
export function renderRecapExportFile(
  recap: LibraryRecap,
  locale: Locale,
  names?: RecapGameNames,
  genreNames?: RecapGenreNames,
): ExportFile {
  const frontmatter = [
    '---',
    'kind: "recap"',
    `observed_days: ${recap.basis.observedDays}`,
    `total_minutes: ${recap.s01.totalMinutes}`,
    `owned: ${recap.s03.owned}`,
    `played: ${recap.s03.played}`,
    `rated_count: ${recap.s04.ratedCount}`,
    `tbti_code: ${JSON.stringify(recap.tbti.code)}`,
    '---',
  ];
  return {
    filename: RECAP_EXPORT_FILENAME,
    content: `${frontmatter.join('\n')}\n\n${renderRecapText(recap, locale, names, genreNames)}\n`,
  };
}
