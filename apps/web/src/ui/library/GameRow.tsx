/**
 * W7 게임 행 — 커버·제목·연도·장르·플레이타임·별·뱃지·행 메뉴.
 * 색·간격·레이아웃은 만지지 않는다. 별점 PUT·숨김은 부모 콜백으로 올린다.
 */
import type { GameFacts } from '../../data/library.js';
import { t, type Locale } from '../i18n/index.js';
import { useLocale } from '../i18n/context.js';
import { filterKeyOf } from './filter.js';
import {
  formatPlaytime,
  formatRelative,
  formatYear,
  starsOf,
} from './format.js';
import { displayNameOf, type SortableGame } from './sort.js';
import { Stars } from './Stars.js';

/** Steam 스토어 URL — ui 상수(Q5). 비steam 행에는 메뉴를 내지 않는다. */
export const STEAM_STORE_URL = 'https://store.steampowered.com/app';

export type RowBadge = 'unrated' | 'missing' | 'filling';

export type RowGame = Omit<GameFacts, 'name'> & { name: string | null };

/** 행 뱃지 판정 — 순수. missing = 열린 보유 구간 없음, filling = 커버·장르 미보충. */
export function rowBadges(facts: RowGame): RowBadge[] {
  const badges: RowBadge[] = [];
  if (facts.latestScore === null) {
    badges.push('unrated');
  }
  if (!facts.ownership.some((span) => !span.ended)) {
    badges.push('missing');
  }
  if (facts.coverUrl === null || facts.genres.length === 0) {
    badges.push('filling');
  }
  return badges;
}

/** 표시 이름 — titleKo 또는 name, 둘 다 없으면 game.untitled(P-4, 정렬 키 아님). */
export function displayGameName(facts: SortableGame, locale: Locale): string {
  return (
    displayNameOf(facts, locale) ??
    t(locale, 'game.untitled', { externalId: facts.key.externalId })
  );
}

export interface GameRowProps {
  facts: RowGame;
  justRated: boolean;
  pending: boolean;
  nowSeconds: number;
  /** 저장 단위 1~10 또는 null(취소). */
  onRate: (score: number | null) => void;
  onToggleHide: () => void;
}

const BADGE_KEYS: Record<RowBadge, 'library.badgeUnrated' | 'library.badgeMissing' | 'library.badgeFilling'> = {
  unrated: 'library.badgeUnrated',
  missing: 'library.badgeMissing',
  filling: 'library.badgeFilling',
};

export function GameRow({
  facts,
  justRated,
  pending,
  nowSeconds,
  onRate,
  onToggleHide,
}: GameRowProps): React.JSX.Element {
  const { locale, text } = useLocale();
  const stars = starsOf(facts.latestScore);
  const year = formatYear(facts);
  const badges = rowBadges(facts);

  return (
    <article aria-labelledby={`title-${facts.key.platform}-${facts.key.externalId}`}>
        {facts.coverUrl === null ? null : (
          <img src={facts.coverUrl} alt="" />
        )}
        <h2 id={`title-${facts.key.platform}-${facts.key.externalId}`}>
          {displayGameName(facts, locale)}
        </h2>
        <div>
          {year === null ? null : <span>{year}</span>}
          {facts.genres.length === 0 ? null : (
            <span>{facts.genres.map((genre) => genre.nameEn).join(', ')}</span>
          )}
          <span>
            {formatPlaytime(facts.confirmedMinutes, locale)}
          </span>
          {facts.lastPlayed === null ? null : (
            <span>{formatRelative(facts.lastPlayed, nowSeconds, locale)}</span>
          )}
        </div>
        <div>
          <Stars
            value={facts.latestScore}
            disabled={pending}
            locale={locale}
            onCommit={(next) =>
              onRate(next === null ? null : Math.round(next * 2))
            }
          />
          {stars === null ? null : <span>{stars}</span>}
        </div>
        <ul>
          {badges.map((badge) => (
            <li key={badge}>{text(BADGE_KEYS[badge])}</li>
          ))}
          {justRated ? <li>{text('library.badgeJustRated')}</li> : null}
        </ul>
        <details>
          <summary>{text('library.ariaMenu')}</summary>
          <div>
            <button type="button" onClick={onToggleHide}>
              {text(facts.hidden ? 'library.unhide' : 'library.hide')}
            </button>
            {facts.key.platform === 'steam' ? (
              <a
                href={`${STEAM_STORE_URL}/${encodeURIComponent(facts.key.externalId)}`}
              >
                {text('library.ariaStore')}
              </a>
            ) : null}
          </div>
        </details>
    </article>
  );
}
