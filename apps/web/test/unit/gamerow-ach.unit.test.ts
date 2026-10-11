import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LocaleProvider } from '../../src/ui/i18n/context.js';
import { GameRow, type RowGame } from '../../src/ui/library/GameRow.js';

/** 행 업적 표기 — summary 있으면 항상 Trophy, 전부 달성일 때만 complete 클래스. */
function makeGame(achievementSummary: { achieved: number; total: number } | null): RowGame {
  return {
    key: { platform: 'steam', externalId: '100' },
    name: 'Store Name',
    titleKo: null,
    developerRaw: null,
    releaseDate: 1588291200,
    releaseDateText: null,
    genres: [],
    coverUrl: null,
    hidden: false,
    libraryAddedAt: null,
    confirmedMinutes: 0,
    lastPlayed: null,
    ownership: [{ origin: 'observed', startedAt: 1700000000, ended: false, endedAt: null, isBaseline: false, syncRunId: null }],
    achievementSummary,
    latestScore: null,
  } as unknown as RowGame;
}

function achSpanOf(facts: RowGame): string | null {
  const row = createElement(GameRow, {
    facts,
    justRated: false,
    justNote: false,
    pending: false,
    nowSeconds: 1700000000,
    onRate: () => undefined,
    onToggleHide: () => undefined,
  });
  const html = renderToStaticMarkup(createElement(LocaleProvider, { language: 'ko', children: row }));
  return /<span class="game-ach[^"]*"[^>]*>.*?<\/span>/.exec(html)?.[0] ?? null;
}

describe('GameRow 업적 표기', () => {
  it('미완료 → Trophy 있음, complete 클래스 없음', () => {
    const span = achSpanOf(makeGame({ achieved: 3, total: 10 }));
    expect(span).not.toBeNull();
    expect(span).toContain('<svg');
    expect(span).not.toContain('game-ach--complete');
    expect(span).toContain('(3/10)');
  });

  it('전부 달성 → Trophy 있음, complete 클래스', () => {
    const span = achSpanOf(makeGame({ achieved: 10, total: 10 }));
    expect(span).toContain('<svg');
    expect(span).toContain('game-ach--complete');
  });

  it('업적 없음(null) → 업적 span 없음', () => {
    expect(achSpanOf(makeGame(null))).toBeNull();
  });
});
