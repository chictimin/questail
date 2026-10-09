/**
 * W7 별점 리스트 화면 — 조립만. 목록·prefs 조회 · 필터·정렬 기억 · 별점·숨김 mutation ·
 * 가상 스크롤 · 포커스 이동 · 토스트. 색·간격·레이아웃은 만지지 않는다.
 */
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import type { GameFacts } from '../../data/library.js';
import type { Prefs } from '../../data/viewState.js';
import { detectLocale, t } from '../i18n/index.js';
import { useLocale } from '../i18n/context.js';
import { filterGames, filterKeyOf, type FilterKey } from '../library/filter.js';
import { GameRow, type RowGame } from '../library/GameRow.js';
import '../library/library.css';
import { LibraryToolbar } from '../library/LibraryToolbar.js';
import { sortGames, type Direction, type SortKey, type SortSpec } from '../library/sort.js';

/** 가상 행 높이 고정값 — 시각 확정 전 자리값(행 높이 고정 원칙만 따른다). 디자인 확정 시 교체. */
const ROW_HEIGHT = 72;
/** 스켈레톤 행 수(UX: 고정 높이 8개). */
const SKELETON_ROWS = 8;
/** 숨김 토스트 유지 시간. */
const HIDE_TOAST_MS = 5000;

type LoadStatus = 'loading' | 'ready' | 'failed';

interface Toast {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

function defaultSort(filterKey: FilterKey): SortSpec {
  if (filterKey === 'byRating') {
    return { sortKey: 'ratedAt', direction: 'desc' };
  }
  return { sortKey: 'playtime', direction: 'desc' };
}

function rememberedSort(prefs: Prefs | null, filterKey: FilterKey): SortSpec {
  const entry = prefs?.sortPerFilter.find((row) => row.filterKey === filterKey);
  if (
    entry !== undefined &&
    isSortKey(entry.sortKey) &&
    (entry.direction === 'asc' || entry.direction === 'desc')
  ) {
    return { sortKey: entry.sortKey, direction: entry.direction };
  }
  return defaultSort(filterKey);
}

function isSortKey(value: string): value is SortKey {
  return (
    value === 'playtime' ||
    value === 'lastPlayed' ||
    value === 'rating' ||
    value === 'ratedAt' ||
    value === 'addedAt' ||
    value === 'releaseDate' ||
    value === 'name'
  );
}

function focusSlider(container: HTMLElement | null, gameKey: string, step: 1 | -1): void {
  if (container === null) return;
  const rows = [...container.querySelectorAll<HTMLElement>('[data-game-key]')];
  const index = rows.findIndex((row) => row.dataset.gameKey === gameKey);
  const neighbor = rows[index + step] ?? rows[index - step];
  neighbor?.querySelector<HTMLElement>('[role="slider"]')?.focus();
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`[web] library 요청 실패: ${response.status}`);
  }
  return (await response.json()) as unknown;
}

export function LibraryPage(): React.JSX.Element {
  const { locale, text } = useLocale();
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [games, setGames] = useState<RowGame[]>([]);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [filterKey, setFilterKey] = useState<FilterKey>('all');
  const [score, setScore] = useState<number | null>(null);
  const [sortSpec, setSortSpec] = useState<SortSpec>({ sortKey: 'playtime', direction: 'desc' });
  const [showEnded, setShowEnded] = useState(false);
  const [keep, setKeep] = useState<string[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const generationRef = useRef(0);
  const [reloadTick, setReloadTick] = useState(0);
  // 토스트 되돌리기가 생성 시점 prefs를 잡지 않게 최신값 미러.
  const prefsRef = useRef<Prefs | null>(null);
  prefsRef.current = prefs;

  useEffect(() => {
    const generation = (generationRef.current += 1);
    const fallback = detectLocale(navigator.language);
    setStatus('loading');
    async function load(): Promise<void> {
      try {
        const [gamesResponse, prefsResponse] = await Promise.all([
          fetch(`/api/library?includeEnded=${showEnded ? 'true' : 'false'}`),
          fetch(`${'/api/prefs'}?fallback=${fallback}`),
        ]);
        const [fetchedGames, fetchedPrefs] = await Promise.all([
          readJson(gamesResponse),
          readJson(prefsResponse),
        ]);
        if (generationRef.current !== generation) return;
        setGames(fetchedGames as RowGame[]);
        const nextPrefs = fetchedPrefs as Prefs;
        setPrefs(nextPrefs);
        setSortSpec(rememberedSort(nextPrefs, filterKey));
        setStatus('ready');
      } catch {
        if (generationRef.current !== generation) return;
        setStatus('failed');
      }
    }
    void load();
  }, [showEnded, reloadTick]);

  useEffect(() => {
    if (toast === null || toast.onAction === undefined) return;
    const timer = setTimeout(() => setToast(null), HIDE_TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    return () => setKeep([]);
  }, []);

  const visible = useMemo(() => {
    const filtered = filterGames(games as GameFacts[], {
      key: filterKey,
      score,
      keep,
    });
    return sortGames(filtered, locale, sortSpec);
  }, [games, filterKey, score, keep, locale, sortSpec]);

  const counts = useMemo<Record<FilterKey, number>>(
    () => {
      // filterGames 4회 호출과 동등(keep 없음) — 단pass 집계. hidden 제외 규칙 포함.
      const result: Record<FilterKey, number> = {
        all: 0,
        unrated: 0,
        byRating: 0,
        hidden: 0,
      };
      for (const game of games as GameFacts[]) {
        if (game.hidden) {
          result.hidden += 1;
          continue;
        }
        result.all += 1;
        if (game.latestScore === null) {
          result.unrated += 1;
        } else {
          result.byRating += 1;
        }
      }
      return result;
    },
    [games],
  );

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    getItemKey: (index) => filterKeyOf(visible[index] as GameFacts),
  });

  async function rate(game: RowGame, nextScore: number | null): Promise<void> {
    const id = filterKeyOf(game);
    setPending((prev) => [...prev, id]);
    try {
      const response = await fetch(
        `/api/ratings/${game.key.platform}/${game.key.externalId}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ score: nextScore }),
        },
      );
      if (!response.ok) {
        throw new Error(`[web] 별점 저장 실패: ${response.status}`);
      }
      const reloaded = (await readJson(
        await fetch(`/api/library?includeEnded=${showEnded ? 'true' : 'false'}`),
      )) as RowGame[];
      setGames(reloaded);
      if (filterKey === 'unrated' || filterKey === 'byRating') {
        setKeep((prev) => (prev.includes(id) ? prev : [...prev, id]));
      }
    } catch {
      setToast({ message: text('library.rateFailed') });
    } finally {
      setPending((prev) => prev.filter((entry) => entry !== id));
    }
  }

  async function toggleHide(game: RowGame): Promise<void> {
    const hidden = new Set(
      prefsRef.current?.hidden.map((entry) => `${entry.platform}/${entry.externalId}`) ?? [],
    );
    const id = filterKeyOf(game);
    if (hidden.has(id)) {
      hidden.delete(id);
    } else {
      hidden.add(id);
    }
    const nextHidden = [...hidden].map((entry) => {
      const [platform, externalId] = entry.split('/') as [string, string];
      return { platform, externalId };
    });
    try {
      const response = await fetch(
        `${'/api/prefs'}?fallback=${detectLocale(navigator.language)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ hidden: nextHidden }),
        },
      );
      const nextPrefs = (await readJson(response)) as Prefs;
      setPrefs(nextPrefs);
      // 숨김은 행 플래그(GET 조인값)에 반영되므로 목록·건수를 다시 읽는다.
      setReloadTick((tick) => tick + 1);
      focusSlider(listRef.current, id, 1);
      if (hidden.has(id)) {
        setToast({
          message: text('library.hiddenNotice'),
          actionLabel: text('library.undoHide'),
          onAction: () => toggleHide(game).catch(() => undefined),
        });
      } else {
        setToast({ message: text('library.unhiddenNotice') });
      }
    } catch {
      setToast({ message: text('library.prefsFailed') });
    }
  }

  function changeFilter(next: FilterKey): void {
    setFilterKey(next);
    setScore(null);
    setKeep([]);
    setSortSpec(rememberedSort(prefs, next));
  }

  function changeScore(next: number | null): void {
    setScore(next);
    setKeep([]);
  }

  async function changeSort(next: SortSpec): Promise<void> {
    setSortSpec(next);
    const entry = {
      filterKey,
      sortKey: next.sortKey,
      direction: next.direction as Direction,
    };
    try {
      const response = await fetch(
        `${'/api/prefs'}?fallback=${detectLocale(navigator.language)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sortPerFilter: [entry] }),
        },
      );
      setPrefs((await readJson(response)) as Prefs);
    } catch {
      setToast({ message: text('library.prefsFailed') });
    }
  }

  function emptyKeys(): {
    title: 'library.emptyAllTitle' | 'library.emptyUnratedTitle' | 'library.emptyRatedTitle' | 'library.emptyScoreTitle' | 'library.emptyHiddenTitle';
    desc: 'library.emptyAllDesc' | 'library.emptyUnratedDesc' | 'library.emptyRatedDesc' | 'library.emptyScoreDesc' | 'library.emptyHiddenDesc';
  } {
    if (filterKey === 'unrated') {
      return { title: 'library.emptyUnratedTitle', desc: 'library.emptyUnratedDesc' };
    }
    if (filterKey === 'hidden') {
      return { title: 'library.emptyHiddenTitle', desc: 'library.emptyHiddenDesc' };
    }
    if (filterKey === 'byRating') {
      return score === null
        ? { title: 'library.emptyRatedTitle', desc: 'library.emptyRatedDesc' }
        : { title: 'library.emptyScoreTitle', desc: 'library.emptyScoreDesc' };
    }
    return { title: 'library.emptyAllTitle', desc: 'library.emptyAllDesc' };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const totalCount = new Intl.NumberFormat(locale).format(games.length);
  const empty = emptyKeys();
  const shownCount = virtualizer.getVirtualItems().length;

  return (
    <main data-route="library">
      <h1>
        {text('library.title')} {totalCount}
        {text('library.count')}
      </h1>
      {status === 'loading' ? (
        <div aria-busy={true}>
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <div key={index} />
          ))}
        </div>
      ) : null}
      {status === 'failed' ? (
        <div role="alert">
          <p>{text('library.loadFailed')}</p>
          <button type="button" onClick={() => setReloadTick((tick) => tick + 1)}>
            {text('library.reload')}
          </button>
        </div>
      ) : null}
      {status === 'ready' ? (
        <>
          <LibraryToolbar
            locale={locale}
            filterKey={filterKey}
            score={score}
            counts={counts}
            resultCount={visible.length}
            sortSpec={sortSpec}
            showEnded={showEnded}
            onFilter={changeFilter}
            onScore={changeScore}
            onSort={(spec) => changeSort(spec).catch(() => undefined)}
            onToggleEnded={() => setShowEnded((prev) => !prev)}
          />
          {visible.length === 0 ? (
            <section>
              <h2>
                {score !== null && filterKey === 'byRating'
                  ? t(locale, 'library.emptyScoreTitle', { v: String(score / 2) })
                  : text(empty.title)}
              </h2>
              <p>{text(empty.desc)}</p>
              {filterKey === 'all' ? (
                <Link href="/sync">{text('library.emptyAllAction')}</Link>
              ) : null}
            </section>
          ) : null}
          {keep.length === 0 ? null : (
            <p>{text('library.justNote')}</p>
          )}
          <div
            ref={listRef}
            className="library-list"
            onKeyDown={(event) => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              const row = (event.target as HTMLElement).closest('[data-game-key]');
              const gameKey = row instanceof HTMLElement ? row.dataset.gameKey : undefined;
              if (gameKey === null || gameKey === undefined) return;
              event.preventDefault();
              focusSlider(listRef.current, gameKey, event.key === 'ArrowDown' ? 1 : -1);
            }}
          >
            <ul
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const game = visible[item.index] as RowGame;
                const id = filterKeyOf(game);
                return (
                  <li
                    key={id}
                    data-game-key={id}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      // 고정 height는 measureElement 실측을 막아 행이 겹친다. 바닥만 둔다.
                      minHeight: `${item.size}px`,
                      transform: `translateY(${item.start}px)`,
                    }}
                  >
                    <GameRow
                      facts={game}
                      justRated={keep.includes(id)}
                      pending={pending.includes(id)}
                      nowSeconds={nowSeconds}
                      onRate={(nextScore) => rate(game, nextScore)}
                      onToggleHide={() => toggleHide(game)}
                    />
                  </li>
                );
              })}
            </ul>
            <p>
              {t(locale, 'library.progress', {
                shown: String(shownCount),
                total: String(visible.length),
              })}
            </p>
          </div>
        </>
      ) : null}
      {toast === null ? null : (
        <div role="status">
          <span>{toast.message}</span>
          {toast.onAction === undefined || toast.actionLabel === undefined ? null : (
            <button type="button" onClick={toast.onAction}>
              {toast.actionLabel}
            </button>
          )}
        </div>
      )}
    </main>
  );
}
