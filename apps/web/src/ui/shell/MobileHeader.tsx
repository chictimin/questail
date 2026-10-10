/**
 * W0 모바일 헤더 — 3칸 그리드 + 메뉴 가로 스크롤 + translateY(-76px) 숨김.
 * README 「헤더 스크롤」: 맨 위(scrollTop<8) 단색 전체 표시, 아래로(Δ>6·scrollTop>80)
 * 심볼 줄만 화면 밖, 위로(Δ<-6) 원위치 + frost. max-height 애니메이션 금지 —
 * 고정 오버레이 + 콘텐츠 padding-top(styles.css).
 * 위임 추가(10-10): window scroll만 듣지 않고 document capture로 내부 스크롤
 * 컨테이너(listRef 등)의 event.target.scrollTop도 받는다. 임계 Δ6·80·8 그대로.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useLocale } from '../i18n/context.js';
import logoUrl from '../../assets/logo-mark.png';
import { Wordmark } from './Wordmark.js';
import { SHELL_MENU } from './menu.js';
import { SummaryPill } from './SummaryPill.js';
import './shell.css';

export function MobileHeader(): React.JSX.Element {
  const { text } = useLocale();
  const [path] = useLocation();
  const [hidden, setHidden] = useState(false);
  const [frost, setFrost] = useState(false);
  const lastY = useRef(new WeakMap<object, number>());

  useEffect(() => {
    setHidden(false);
    setFrost(false);
    lastY.current = new WeakMap();
  }, [path]);

  useEffect(() => {
    const onScroll = (event: Event): void => {
      const target = event.target;
      let key: object;
      let y: number;
      if (
        target instanceof Element &&
        target !== document.documentElement &&
        target !== document.body
      ) {
        if (target.scrollHeight <= target.clientHeight) {
          // 수평 스크롤(메뉴 줄 등) — 상태·기준값 갱신 없음.
          return;
        }
        // 수직 내부 스크롤 컨테이너 — 같은 원천의 직전 값과만 비교한다.
        key = target;
        y = target.scrollTop;
      } else {
        key = document;
        y = window.scrollY;
      }
      const prev = lastY.current.get(key) ?? 0;
      const dy = y - prev;
      lastY.current.set(key, y);
      if (y < 8) {
        setHidden(false);
        setFrost(false);
      } else if (dy > 6 && y > 80) {
        setHidden(true);
      } else if (dy < -6) {
        setHidden(false);
        setFrost(true);
      }
    };
    document.addEventListener('scroll', onScroll, {
      capture: true,
      passive: true,
    });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, []);

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
