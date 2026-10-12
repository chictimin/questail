/**
 * W0 모바일 헤더 — 3칸 그리드 + 메뉴 가로 스크롤 + translateY(-76px) 숨김.
 * README 「헤더 스크롤」: 맨 위(scrollTop<8) 단색 전체 표시, 아래로(Δ>6·scrollTop>80)
 * 심볼 줄만 화면 밖, 위로(Δ<-6) 원위치 + frost. max-height 애니메이션 금지 —
 * 고정 오버레이 + 콘텐츠 padding-top(styles.css).
 * 상태는 chrome.tsx 단일 출처. 팝오버 열림 동안(lockedRef)·팝오버 자식 스크롤은 판정 제외,
 * 해제·라우트 이동 시 기준값을 그 시점 scrollTop으로 재설정한다(가짜 큰 Δ 방지).
 * 위임 추가(10-10): window scroll만 듣지 않고 document capture로 내부 스크롤
 * 컨테이너(listRef 등)의 event.target.scrollTop도 받는다. 임계 Δ6·80·8 그대로.
 */
import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import { useLocale } from '../i18n/context.js';
import logoUrl from '../../assets/logo-mark.png';
import { Wordmark } from './Wordmark.js';
import { SHELL_MENU } from './menu.js';
import { SummaryPill } from './SummaryPill.js';
import { useChrome } from './chrome.js';
import './shell.css';

export function MobileHeader(): React.JSX.Element {
  const { text } = useLocale();
  const [path] = useLocation();
  const { state, setState, lockedRef, rebaselineRef } = useChrome();
  const { hidden, frost } = state;
  const stateRef = useRef(state);
  stateRef.current = state;
  const lastY = useRef(new Map<object, number>());

  /** 현재 원천별 scrollTop을 기준값으로 — 이후 첫 Δ는 실제 사용자 이동분만. */
  const rebaseline = useRef((): void => {
    lastY.current = new Map();
    lastY.current.set(document, window.scrollY);
    let anyBelow = window.scrollY >= 8;
    document
      .querySelectorAll<HTMLElement>('[data-chrome-scroll]')
      .forEach((el) => {
        lastY.current.set(el, el.scrollTop);
        if (el.scrollTop >= 8) anyBelow = true;
      });
    if (!anyBelow && stateRef.current.hidden) {
      setState({ hidden: false, frost: false, inner: false });
    }
  });

  useEffect(() => {
    rebaselineRef.current = rebaseline.current;
    return () => {
      rebaselineRef.current = null;
    };
  }, [rebaselineRef]);

  useEffect(() => {
    setState({ hidden: false, frost: false, inner: false });
    rebaseline.current();
  }, [path, setState]);

  useEffect(() => {
    const onScroll = (event: Event): void => {
      if (lockedRef.current) return;
      const target = event.target;
      let key: object;
      let y: number;
      let inner: boolean;
      if (
        target instanceof Element &&
        target !== document.documentElement &&
        target !== document.body
      ) {
        if (target.closest('[data-chrome-ignore]') !== null) return;
        if (target.scrollHeight <= target.clientHeight) {
          // 수평 스크롤(메뉴 줄 등) — 상태·기준값 갱신 없음.
          return;
        }
        // 수직 내부 스크롤 컨테이너 — 같은 원천의 직전 값과만 비교한다.
        key = target;
        y = target.scrollTop;
        inner = true;
      } else {
        key = document;
        y = window.scrollY;
        inner = false;
      }
      const prev = lastY.current.get(key) ?? 0;
      const dy = y - prev;
      lastY.current.set(key, y);
      const current = stateRef.current;
      if (y < 8) {
        if (current.hidden || current.frost) {
          setState({ hidden: false, frost: false, inner });
        }
      } else if (dy > 6 && y > 80) {
        if (!current.hidden || current.inner !== inner) {
          setState({ hidden: true, frost: current.frost, inner });
        }
      } else if (dy < -6) {
        if (current.hidden || !current.frost) {
          setState({ hidden: false, frost: true, inner });
        }
      }
    };
    document.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [lockedRef, setState]);

  const className =
    'mobile-header' +
    (hidden ? ' is-hidden' : '') +
    (!hidden && frost ? ' is-frost' : '');
  return (
    <header className={className}>
      <div className="mobile-header-top">
        <span aria-hidden="true" />
        <div className="mobile-header-center">
          <img
            className="shell-symbol"
            src={logoUrl}
            alt={text('shell.logoAlt')}
            width={40}
            height={40}
          />
          <Wordmark />
        </div>
        <SummaryPill narrow />
      </div>
      <nav className="mobile-menu">
        {SHELL_MENU.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={path === href ? 'page' : undefined}
          >
            <Icon size={16} aria-hidden />
            {text(label)}
          </Link>
        ))}
      </nav>
    </header>
  );
}
