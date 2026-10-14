/**
 * W7 행 표시 문자열 — 순수 함수. 날짜·숫자는 UI Intl(L-4).
 * 연도는 epoch(UTC) → 없으면 원문 → 없으면 null이다.
 */
import { formatHours, formatStar } from '../../shared/format.js';
import { t, type Locale } from '../i18n/index.js';

interface ReleaseDateSource {
  releaseDate: number | null;
  releaseDateText: string | null;
}

export function formatYear(facts: ReleaseDateSource): string | null {
  if (facts.releaseDate !== null) {
    return String(new Date(facts.releaseDate * 1000).getUTCFullYear());
  }
  return facts.releaseDateText;
}

/** 확인 누적 분 → 시간 단위 문자열(정수 반올림, C15-5). */
export function formatPlaytime(minutes: number, locale: Locale): string {
  return `${formatHours(minutes)}${t(locale, 'library.unitHours')}`;
}

/** epoch 초 → 로케일 날짜. */
export function formatDate(epochSeconds: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(epochSeconds * 1000));
}

/** epoch 초 → 상대 시간. nowSeconds 주입으로 테스트한다. */
export function formatRelative(
  epochSeconds: number,
  nowSeconds: number,
  locale: Locale,
): string {
  const diff = epochSeconds - nowSeconds;
  const abs = Math.abs(diff);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < 60) return formatter.format(Math.trunc(diff), 'second');
  if (abs < 3600) return formatter.format(Math.trunc(diff / 60), 'minute');
  if (abs < 86400) return formatter.format(Math.trunc(diff / 3600), 'hour');
  return formatter.format(Math.trunc(diff / 86400), 'day');
}

/** 별점 저장값(1~10) → 별 단위(0.5~5). 미평가는 null이다. */
export function starsOf(score: number | null): number | null {
  return score === null ? null : score / 2;
}

/** aria-valuetext. */
export function starsValueText(score: number | null, locale: Locale): string {
  if (score === null) return t(locale, 'library.starsUnrated');
  return t(locale, 'library.starsValue', { v: formatStar(score / 2) });
}
