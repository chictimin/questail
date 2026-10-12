/** U2a 필터 버튼 + 팝오버 — 토글 2개(한 줄) + 정렬(기준 select + 방향 토글 버튼). details/summary 네이티브. */
import { useEffect, useRef, useState } from 'react';
import {
  CircleNotch,
  SlidersHorizontal,
  SortAscending,
  SortDescending,
} from '@phosphor-icons/react';
import { t, type Locale } from '../../i18n/index.js';
import { useChrome } from '../../shell/chrome.js';
import '../toolbar.css';
import { acquirePopoverLock } from '../popoverLock.js';
import { SORT_KEYS, type SortKey, type SortSpec } from '../sort.js';
import { SORT_KEY_LABELS } from '../sortLabels.js';
import { sortAfterDirectionToggle, sortAfterKeyChange, isSortKey } from '../sortState.js';

/** 팝오버 하단 여백(viewport 안에 두는 간격). */
const POPOVER_VIEWPORT_GAP = 16;
/** 아주 낮은 viewport에서도 내부 스크롤이 가능하도록 두는 최소 높이. */
const POPOVER_MIN_HEIGHT = 120;

export function FilterButton({
  locale,
  badgeCount,
  showEnded,
  hideShortPlaytime,
  sortSpec,
  busy,
  onToggleEnded,
  onToggleHideShortPlaytime,
  onSort,
}: {
  locale: Locale;
  /** 켜진 필터 개수 — null이면 뱃지 없음. 정렬은 세지 않는다. */
  badgeCount: number | null;
  showEnded: boolean;
  hideShortPlaytime: boolean;
  sortSpec: SortSpec;
  /** 빠진 게임 재조회 중 — 정렬·방향·30분 토글 disabled, 빠진 게임 토글은 진행 표시만. */
  busy: boolean;
  onToggleEnded: () => void;
  onToggleHideShortPlaytime: () => void;
  onSort: (spec: SortSpec) => void;
}): React.JSX.Element {
  const { setLocked } = useChrome();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  function close(refocus: boolean): void {
    const details = detailsRef.current;
    if (details === null || !details.open) return;
    details.open = false;
    setOpen(false);
    if (refocus) summaryRef.current?.focus();
  }

  // 열린 동안: 헤더 판정 중단 + 배경 스크롤 잠금 + 닫힘 조건(바깥 포인터·포커스 이탈).
  useEffect(() => {
    if (!open) return;
    const popover = popoverRef.current;
    if (popover === null) return;
    setLocked(true);
    const release = acquirePopoverLock(popover);
    const details = detailsRef.current;
    const onPointerDown = (event: Event): void => {
      if (event.target instanceof Node && details?.contains(event.target)) return;
      close(false);
    };
    const onFocusIn = (event: FocusEvent): void => {
      if (event.target instanceof Node && details?.contains(event.target)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('focusin', onFocusIn);
      release();
      setLocked(false);
    };
  }, [open, setLocked]);

  // 팝오버 하단이 viewport 안에 들도록 max-height를 위치에서 계산한다.
  useEffect(() => {
    if (!open) return;
    const popover = popoverRef.current;
    if (popover === null) return;
    function fit(): void {
      if (popover === null) return;
      const top = popover.getBoundingClientRect().top;
      const limit = Math.max(
        POPOVER_MIN_HEIGHT,
        Math.floor(window.innerHeight - top - POPOVER_VIEWPORT_GAP),
      );
      popover.style.maxHeight = `${limit}px`;
    }
    fit();
    window.addEventListener('resize', fit);
    return () => {
      window.removeEventListener('resize', fit);
      popover.style.maxHeight = '';
    };
  }, [open]);

  const directionLabel = `${t(locale, 'library.sortDirection')} ${t(
    locale,
    sortSpec.direction === 'asc' ? 'library.sortAsc' : 'library.sortDesc',
  )}`;
  const DirectionIcon = sortSpec.direction === 'asc' ? SortAscending : SortDescending;

  return (
    <details
      ref={detailsRef}
      className="lib-filter"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && detailsRef.current?.open === true) {
          event.preventDefault();
          close(true);
        }
      }}
    >
      <summary ref={summaryRef} className="lib-filter-btn" aria-label={t(locale, 'library.filterButton')}>
        <SlidersHorizontal size={16} aria-hidden />
        <span className="filter-text">{t(locale, 'library.filterButton')}</span>
        {badgeCount !== null && <span className="lib-filter-badge">{badgeCount}</span>}
      </summary>
      <div
        ref={popoverRef}
        className="lib-popover"
        role="dialog"
        aria-label={t(locale, 'library.filterButton')}
        data-chrome-ignore
      >
        <div className="lib-popover-toggles">
          <label className="lib-popover-switch" aria-busy={busy}>
            <span className="lib-popover-switch-label">{t(locale, 'library.showEnded')}</span>
            {busy ? <CircleNotch size={14} aria-hidden className="qt-spin" /> : null}
            <input
              type="checkbox"
              className="lib-switch"
              role="switch"
              aria-checked={showEnded}
              checked={showEnded}
              onChange={() => onToggleEnded()}
            />
          </label>
          <label className="lib-popover-switch">
            <span className="lib-popover-switch-label">{t(locale, 'library.hideShortPlaytime')}</span>
            <input
              type="checkbox"
              className="lib-switch"
              role="switch"
              aria-checked={hideShortPlaytime}
              checked={hideShortPlaytime}
              disabled={busy}
              onChange={() => onToggleHideShortPlaytime()}
            />
          </label>
        </div>
        <div className="lib-popover-divider" aria-hidden />
        <span className="lib-popover-heading">{t(locale, 'library.sortTitle')}</span>
        <div className="lib-popover-sortrow">
          <select
            className="lib-sort-select"
            aria-label={t(locale, 'library.sortTitle')}
            value={sortSpec.sortKey}
            disabled={busy}
            onChange={(event) => {
              const next: string = event.target.value;
              if (isSortKey(next)) onSort(sortAfterKeyChange(next as SortKey));
            }}
          >
            {SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {t(locale, SORT_KEY_LABELS[key])}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="lib-sort-dir"
            aria-label={directionLabel}
            title={directionLabel}
            disabled={busy}
            onClick={() => onSort(sortAfterDirectionToggle(sortSpec))}
          >
            <DirectionIcon size={18} aria-hidden />
          </button>
        </div>
      </div>
    </details>
  );
}
