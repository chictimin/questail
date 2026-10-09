/**
 * W7 게임 행 — 커버·제목·연도·장르·플레이타임·별·뱃지·액션.
 * 별점 PUT·숨김은 부모 콜백으로 올린다. 행 메뉴 없이 아이콘 버튼 2개 직접 노출(U2b).
 */
import type { GameFacts } from '../../data/library.js';
import { Check, CircleNotch, EyeSlash, LinkBreak, SteamLogo } from '@phosphor-icons/react';
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
import { genreDisplayNames } from '../../shared/genres.js';
import { Stars } from './Stars.js';
import './row.css';

/** Steam 스토어 URL — ui 상수(Q5). 비steam 행에는 메뉴를 내지 않는다. */
export const STEAM_STORE_URL = 'https://store.steampowered.com/app';

export type RowGame = Omit<GameFacts, 'name'> & { name: string | null };

/** 행 뱃지 판정 — 순수. missing = 열린 보유 구간 없음, filling = 커버·장르 미보충. */
export function rowBadges(facts: RowGame): { missing: boolean; filling: boolean } {
  return {
    missing: !facts.ownership.some((span) => !span.ended),
    filling: facts.coverUrl === null || facts.genres.length === 0,
  };
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
  /** 미평가 탭 방금 매김 안내(넓은 폭만 표시, 좁은 폭 CSS 숨김). */
  justNote: boolean;
  pending: boolean;
  nowSeconds: number;
  /** 저장 단위 1~10 또는 null(취소). */
  onRate: (score: number | null) => void;
  onToggleHide: () => void;
}

export function GameRow({
  facts,
  justRated,
  justNote,
  pending,
  nowSeconds,
  onRate,
  onToggleHide,
}: GameRowProps): React.JSX.Element {
  const { locale, text } = useLocale();
  const stars = starsOf(facts.latestScore);
  const year = formatYear(facts);
  const badges = rowBadges(facts);
  const displayGenres = genreDisplayNames(facts.genres, locale);
  const noteId = `just-note-${facts.key.platform}-${facts.key.externalId}`;

  return (
    <article
      aria-labelledby={`title-${facts.key.platform}-${facts.key.externalId}`}
      aria-describedby={justNote ? noteId : undefined}
      className="game-row"
      data-just-rated={justRated || undefined}
    >
        {facts.coverUrl === null ? (
          <span className="game-cover" data-placeholder aria-hidden />
        ) : (
          <img className="game-cover" src={facts.coverUrl} alt="" />
        )}
        <div className="game-row-main">
          <h2
            id={`title-${facts.key.platform}-${facts.key.externalId}`}
            className="game-row-title"
          >
            {displayGameName(facts, locale)}
          </h2>
          <div className="game-row-meta">
            {year === null ? null : <span>{year}</span>}
            {displayGenres.length === 0 ? null : (
              <span>{displayGenres.join(', ')}</span>
            )}
          </div>
        </div>
        <div className="game-row-sub">
          <span className="game-row-hours">
            {formatPlaytime(facts.confirmedMinutes, locale)}
          </span>
          {facts.lastPlayed === null ? null : (
            <span className="game-row-last">
              {formatRelative(facts.lastPlayed, nowSeconds, locale)}
            </span>
          )}
        </div>
        <div className="game-row-rate">
          <Stars
            value={facts.latestScore}
            disabled={pending}
            locale={locale}
            onCommit={(next) =>
              onRate(next === null ? null : Math.round(next * 2))
            }
          />
          {stars === null ? null : <span className="game-row-num">{stars}</span>}
        </div>
        <div>
          {badges.missing && (
            <LinkBreak
              size={24}
              color="var(--qt-orange)"
              aria-label={text('library.badgeMissing')}
            />
          )}
          {badges.filling && (
            <CircleNotch
              size={24}
              color="var(--qt-purple)"
              className="badge-spin"
              aria-label={text('library.badgeFilling')}
            />
          )}
          {justRated && (
            <Check
              size={24}
              color="var(--qt-mint)"
              aria-label={text('library.badgeJustRated')}
            />
          )}
        </div>
        <div className="game-row-actions">
          <button
            type="button"
            className="row-action"
            aria-label={text(facts.hidden ? 'library.unhide' : 'library.hide')}
            onClick={onToggleHide}
          >
            <EyeSlash size={18} aria-hidden />
          </button>
          {facts.key.platform === 'steam' ? (
            <a
              className="row-action"
              href={`${STEAM_STORE_URL}/${encodeURIComponent(facts.key.externalId)}`}
              aria-label={text('library.ariaStore')}
            >
              <SteamLogo size={18} aria-hidden />
            </a>
          ) : null}
        </div>
      {justNote ? (
        <span id={noteId} className="game-just-note">
          {text('library.justNote')}
        </span>
      ) : null}
    </article>
  );
}
