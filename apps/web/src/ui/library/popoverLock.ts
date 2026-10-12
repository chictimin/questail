/**
 * 정렬·필터 팝오버가 열린 동안의 배경 스크롤 잠금.
 * 리스트(data-chrome-scroll)는 overflow 숨김, 문서·리스트 휠/터치는 팝오버 밖에서만 차단.
 * 해제 시 열기 전 window.scrollY·리스트 scrollTop을 되돌린다(의도적 리셋은 noteIntentionalReset).
 */
interface Saved {
  list: HTMLElement | null;
  top: number;
  y: number;
}

let saved: Saved | null = null;

export function acquirePopoverLock(popover: HTMLElement): () => void {
  const list = document.querySelector<HTMLElement>('[data-chrome-scroll]');
  const mine: Saved = { list, top: list?.scrollTop ?? 0, y: window.scrollY };
  saved = mine;
  const prevOverflow = list?.style.overflowY ?? '';
  if (list !== null) list.style.overflowY = 'hidden';
  /** 팝오버 안 스크롤은 그 방향으로 더 갈 수 있을 때만 허용 — 끝에서는 문서로 번지지 않게 막는다. */
  const popoverCanScroll = (delta: number): boolean => {
    const room = popover.scrollHeight - popover.clientHeight;
    if (room <= 1) return false;
    if (delta < 0) return popover.scrollTop >= 1;
    return room - popover.scrollTop >= 1;
  };
  let touchY = 0;
  const onTouchStart = (event: Event): void => {
    touchY = (event as TouchEvent).touches[0]?.clientY ?? 0;
  };
  const block = (event: Event): void => {
    if (!event.cancelable) return;
    if (event.target instanceof Node && popover.contains(event.target)) {
      let delta = 0;
      if (event instanceof WheelEvent) {
        delta = event.deltaY;
      } else {
        const y = (event as TouchEvent).touches[0]?.clientY ?? touchY;
        delta = touchY - y;
        touchY = y;
      }
      if (popoverCanScroll(delta)) return;
    }
    event.preventDefault();
  };
  document.addEventListener('wheel', block, { passive: false });
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove', block, { passive: false });
  return () => {
    document.removeEventListener('wheel', block);
    document.removeEventListener('touchstart', onTouchStart);
    document.removeEventListener('touchmove', block);
    if (list !== null) {
      list.style.overflowY = prevOverflow;
      if (list.scrollTop !== mine.top) list.scrollTop = mine.top;
    }
    if (window.scrollY !== mine.y) window.scrollTo(0, mine.y);
    if (saved === mine) saved = null;
  };
}

/** 게임 집합이 바뀌어 리스트를 0으로 되돌린 경우 — 해제 시 옛 위치로 복원하지 않는다. */
export function noteIntentionalReset(): void {
  if (saved !== null) saved.top = 0;
}
