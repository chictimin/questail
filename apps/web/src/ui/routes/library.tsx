/**
 * W7 별점 리스트 화면 — 조립만. 목록·prefs 조회 · 필터·정렬 기억 · 별점·숨김 mutation ·
 * 가상 스크롤 · 포커스 이동 · 토스트. 색·간격·레이아웃은 만지지 않는다.
 */
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { CircleDashed, EyeSlash, Star, StarHalf, WarningCircle } from '@phosphor-icons/react';
import type { GameFacts } from '../../data/library.js';
import type { Prefs } from '../../data/viewState.js';
import { detectLocale, t } from '../i18n/index.js';
import { useLocale } from '../i18n/context.js';
import { filterGames, filterKeyOf, type FilterKey } from '../library/filter.js';
import { GameRow, type RowGame } from '../library/GameRow.js';
import '../library/library.css';
import { LibraryToolbar } from '../library/LibraryToolbar.js';
import { sortGames, type Direction, type SortSpec } from '../library/sort.js';
import {
  clampScrollTop,
  createLoadSequence,
  createPrefsWriteGuard,
  rememberedSort,
} from '../library/sortState.js';
import { noteIntentionalReset } from '../library/popoverLock.js';
import { FirstSyncBanner } from '../library/FirstSyncBanner.js';
import {
  firstSyncBannerFor,
  shouldRefetchOnSettle,
  showOwnedSkeleton,
} from '../library/bannerState.js';
import { useSyncStatus } from '../sync/statusContext.js';
import logoUrl from '../../assets/logo-mark.png';

/** 가상 행 높이 고정값 — 시각 확정 전 자리값(행 높이 고정 원칙만 따른다). 디자인 확정 시 교체. */
const ROW_HEIGHT = 72;
/** 30분 이하 가리기 판정 상한(분). */
const SHORT_PLAYTIME_MINUTES = 30;
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
  const [hideShortPlaytime, setHideShortPlaytime] = useState(false);
  const [keep, setKeep] = useState<string[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const { entries } = useSyncStatus();
  const listRef = useRef<HTMLDivElement>(null);
  const loadSeqRef = useRef(createLoadSequence());
  // 스켈레톤 구간에 리스트가 언마운트되므로 진입 전 scrollTop을 보관했다가 데이터 교체 후 복원(null = 없음).
  const savedScrollRef = useRef<number | null>(null);
  // 빠진 게임 토글 뒤 첫 적용 응답에서 맨 위로 되돌릴 표식 — 겹친 재조회가 앞 요청을 대체해도 유지된다.
  const resetScrollRef = useRef(false);
  const [reloadTick, setReloadTick] = useState(0);
  // 빠진 게임 재조회 중 — 툴바·팝오버·리스트는 그대로 두고 관련 컨트롤만 잠근다.
  const [refetching, setRefetching] = useState(false);
  const prefsGuardRef = useRef(createPrefsWriteGuard());
  const filterKeyRef = useRef<FilterKey>('all');
  filterKeyRef.current = filterKey;
  const previousShowEndedRef = useRef(showEnded);
  const statusRef = useRef<LoadStatus>('loading');
  statusRef.current = status;
  // 토스트 되돌리기가 생성 시점 prefs를 잡지 않게 최신값 미러.
  const prefsRef = useRef<Prefs | null>(null);
  prefsRef.current = prefs;

  useEffect(() => {
    const fallback = detectLocale(navigator.language);
    // 빠진 게임 토글이 부른 재조회만 제자리 교체(툴바·리스트 유지). 그 밖은 스켈레톤.
    const showEndedChanged = previousShowEndedRef.current !== showEnded;
    previousShowEndedRef.current = showEnded;
    const inPlace = showEndedChanged && statusRef.current === 'ready';
    const prefsToken = prefsGuardRef.current.begin();
    const seq = loadSeqRef.current;
    const generation = seq.begin(inPlace);
    if (showEndedChanged) {
      resetScrollRef.current = true;
    } else if (!inPlace && statusRef.current === 'ready' && savedScrollRef.current === null) {
      savedScrollRef.current = listRef.current?.scrollTop ?? null;
    }
    setRefetching(seq.isBusy());
    if (!inPlace) setStatus('loading');
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
        if (!seq.isLatest(generation)) return;
        setGames(fetchedGames as RowGame[]);
        // load 시작 이후 사용자 PUT이 있었으면 이 응답의 prefs는 옛 값 — 적용하지 않는다.
        if (!prefsGuardRef.current.isStale(prefsToken)) {
          const nextPrefs = fetchedPrefs as Prefs;
          setPrefs(nextPrefs);
          setHideShortPlaytime(nextPrefs.hideShortPlaytime === true);
          setSortSpec(rememberedSort(nextPrefs, filterKeyRef.current));
        }
        if (resetScrollRef.current) {
          // 게임 집합이 바뀌었으므로 리스트는 맨 위부터.
          resetScrollRef.current = false;
          savedScrollRef.current = 0;
          const list = listRef.current;
          if (list !== null) list.scrollTop = 0;
          noteIntentionalReset();
        }
        setStatus('ready');
      } catch {
        if (!seq.isLatest(generation)) return;
        resetScrollRef.current = false;
        savedScrollRef.current = null;
        setStatus('failed');
      } finally {
        // 최신 요청만 busy를 정리한다 — 오래된 요청은 건드리지 않는다.
        seq.settle(generation);
        if (seq.isLatest(generation)) setRefetching(false);
      }
    }
    void load();
  }, [showEnded, reloadTick]);

  // 결정 B — meta·owned가 running에서 정착하는 순간 목록만 1회 조용히 재조회(스켈레톤 없음).
  const previousEntriesRef = useRef(entries);
  useEffect(() => {
    const previous = previousEntriesRef.current;
    previousEntriesRef.current = entries;
    if (!shouldRefetchOnSettle(previous, entries)) return;
    const generation = loadSeqRef.current.current();
    fetch(`/api/library?includeEnded=${showEnded ? 'true' : 'false'}`)
      .then(readJson)
      .then((reloaded) => {
        if (loadSeqRef.current.isLatest(generation)) setGames(reloaded as RowGame[]);
      })
      .catch(() => undefined);
  }, [entries]);

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
    const withoutShort = hideShortPlaytime
      ? filtered.filter((facts) => facts.confirmedMinutes > SHORT_PLAYTIME_MINUTES)
      : filtered;
    return sortGames(withoutShort, locale, sortSpec);
  }, [games, filterKey, score, keep, locale, sortSpec, hideShortPlaytime]);

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
    // 좁은 폭(640px 미만) 행 104 — 첫 스크롤 점프 방지. 측정 후엔 실측값 사용.
    estimateSize: () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 639.98px)').matches
        ? 104
        : ROW_HEIGHT,
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
    prefsGuardRef.current.noteWrite();
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

  async function persistHideShortPlaytime(value: boolean): Promise<void> {
    prefsGuardRef.current.noteWrite();
    try {
      const response = await fetch(
        `${'/api/prefs'}?fallback=${detectLocale(navigator.language)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ hideShortPlaytime: value }),
        },
      );
      setPrefs((await readJson(response)) as Prefs);
    } catch {
      setToast({ message: text('library.prefsFailed') });
    }
  }

  function toggleHideShortPlaytime(): void {
    const next = !hideShortPlaytime;
    setHideShortPlaytime(next);
    persistHideShortPlaytime(next).catch(() => undefined);
  }

  async function changeSort(next: SortSpec): Promise<void> {
    setSortSpec(next);
    const entry = {
      filterKey,
      sortKey: next.sortKey,
      direction: next.direction as Direction,
    };
    prefsGuardRef.current.noteWrite();
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
  const banner = firstSyncBannerFor(entries, games);
  const ownedLoading = showOwnedSkeleton(entries, games.length);

  // 스켈레톤 뒤 리스트가 다시 마운트·렌더된 직후 저장한 scrollTop 복원(행 수가 줄었으면 절삭).
  useLayoutEffect(() => {
    const saved = savedScrollRef.current;
    if (saved === null || status !== 'ready' || ownedLoading) return;
    savedScrollRef.current = null;
    const list = listRef.current;
    if (list === null) return;
    list.scrollTop = clampScrollTop(saved, list.scrollHeight, list.clientHeight);
  });

  return (
    <main data-route="library">
      <div className="lib-head">
        <h1 className="lib-title">{text('library.title')}</h1>
        <span className="lib-total">
          {totalCount}
          {text('library.count')}
        </span>
      </div>
      {status === 'loading' || (status === 'ready' && ownedLoading) ? (
        <div aria-busy={true} className="lib-skel">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <div key={index} className="lib-skel-row">
              <div className="lib-skel-cover" aria-hidden />
              <div className="lib-skel-lines" aria-hidden>
                <div className="lib-skel-line" />
                <div className="lib-skel-sub" />
              </div>
              <div className="lib-skel-star" aria-hidden />
            </div>
          ))}
        </div>
      ) : null}
      {status === 'failed' ? (
        <div role="alert" className="lib-fail">
          <WarningCircle size={18} aria-hidden />
          <p className="lib-fail-text">{text('library.loadFailed')}</p>
          <button
            type="button"
            className="lib-fail-btn"
            onClick={() => setReloadTick((tick) => tick + 1)}
          >
            {text('library.reload')}
          </button>
        </div>
      ) : null}
      {status === 'ready' && !ownedLoading ? (
        <>
          {banner === null ? null : <FirstSyncBanner model={banner} />}
          {games.length === 0 ? null : (
          <LibraryToolbar
            locale={locale}
            filterKey={filterKey}
            score={score}
            counts={counts}
            resultCount={visible.length}
            sortSpec={sortSpec}
            showEnded={showEnded}
            hideShortPlaytime={hideShortPlaytime}
            busy={refetching}
            onFilter={changeFilter}
            onScore={changeScore}
            onSort={(spec) => changeSort(spec).catch(() => undefined)}
            onToggleEnded={() => setShowEnded((prev) => !prev)}
            onToggleHideShortPlaytime={() => toggleHideShortPlaytime()}
          />
          )}
          {visible.length === 0 ? (
            <section className="lib-empty">
              {filterKey === 'all' ? (
                <img className="lib-empty-logo" src={logoUrl} alt="" />
              ) : filterKey === 'unrated' ? (
                <CircleDashed size={28} aria-hidden className="lib-empty-icon" />
              ) : filterKey === 'hidden' ? (
                <EyeSlash size={28} aria-hidden className="lib-empty-icon" />
              ) : score !== null ? (
                <StarHalf size={28} aria-hidden className="lib-empty-icon" />
              ) : (
                <Star size={28} aria-hidden className="lib-empty-icon" />
              )}
              <h2 className="lib-empty-title">
                {score !== null && filterKey === 'byRating'
                  ? t(locale, 'library.emptyScoreTitle', { v: String(score / 2) })
                  : text(empty.title)}
              </h2>
              <p className="lib-empty-desc">{text(empty.desc)}</p>
              {filterKey === 'all' ? (
                <Link href="/sync" className="lib-empty-action">
                  {text('library.emptyAllAction')}
                </Link>
              ) : null}
            </section>
          ) : null}
          {visible.length === 0 ? null : (
          <div
            ref={listRef}
            className="library-list"
            data-chrome-scroll
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
              className="lib-virtual"
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
                      // U2b-F1 ② 고정 높이 — 행 내용이 fits + ellipsis라 실측 상수 유지.
                      height: `${item.size}px`,
                      transform: `translateY(${item.start}px)`,
                    }}
                  >
                    <GameRow
                      facts={game}
                      justRated={keep.includes(id)}
                      justNote={keep.includes(id) && filterKey === 'unrated'}
                      pending={pending.includes(id)}
                      nowSeconds={nowSeconds}
                      onRate={(nextScore) => rate(game, nextScore)}
                      onToggleHide={() => toggleHide(game)}
                    />
                  </li>
                );
              })}
            </ul>
            <p className="lib-more">
              {t(locale, 'library.progress', {
                shown: String(shownCount),
                total: String(visible.length),
              })}
            </p>
          </div>
          )}
        </>
      ) : null}
      {toast === null ? null : (
        <div role="status" className="lib-toast">
          {toast.onAction === undefined ? null : (
            <EyeSlash size={16} aria-hidden />
          )}
          <span className="lib-toast-text">{toast.message}</span>
          {toast.onAction === undefined || toast.actionLabel === undefined ? null : (
            <button
              type="button"
              className="lib-toast-btn"
              onClick={toast.onAction}
            >
              {toast.actionLabel}
            </button>
          )}
        </div>
      )}
    </main>
  );
}
