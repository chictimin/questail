import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GameFacts } from '../../src/data/library.js';
import { t } from '../../src/ui/i18n/index.js';
import { LocaleProvider } from '../../src/ui/i18n/context.js';
import { GameRow, type RowGame } from '../../src/ui/library/GameRow.js';

/** 행 메타 줄 — 장르 0개면 genrePending, 있으면 기존 연도·장르 부제. */
function makeGame(genres: GameFacts['genres']): RowGame {
  return {
    key: { platform: 'steam', externalId: '100' },
    name: 'Store Name',
    titleKo: null,
    developerRaw: null,
    releaseDate: 1588291200,
    releaseDateText: null,
    genres,
    coverUrl: null,
    hidden: false,
    libraryAddedAt: null,
    confirmedMinutes: 0,
    lastPlayed: null,
    ownership: [{ origin: 'observed', startedAt: 1700000000, ended: false, endedAt: null, isBaseline: false, syncRunId: null }],
    achievementSummary: null,
    latestScore: null,
  } as unknown as RowGame;
}

function metaOf(facts: RowGame, language: 'ko' | 'en'): string {
  const row = createElement(GameRow, {
    facts,
    justRated: false,
    justNote: false,
    pending: false,
    nowSeconds: 1700000000,
    onRate: () => undefined,
    onToggleHide: () => undefined,
  });
  const html = renderToStaticMarkup(
    createElement(LocaleProvider, { language, children: row }),
  );
  const match = /<div class="game-row-meta">(.*?)<\/div>/.exec(html);
  return (match?.[1] ?? '').replace(/<[^>]+>/g, '|');
}

describe('GameRow 메타 줄', () => {
  it('장르 0개 → genrePending(연도 대체)', () => {
    expect(metaOf(makeGame([]), 'ko')).toContain(t('ko', 'library.genrePending'));
    expect(metaOf(makeGame([]), 'en')).toContain(t('en', 'library.genrePending'));
    expect(metaOf(makeGame([]), 'ko')).not.toContain('2020');
  });

  it('장르 있음 → 기존 부제(genrePending 없음)', () => {
    const meta = metaOf(makeGame([{ genreId: 'action', nameEn: 'Action', nameKo: null }] as unknown as GameFacts['genres']), 'en');
    expect(meta).not.toContain(t('en', 'library.genrePending'));
    expect(meta).toContain('2020');
  });
});
