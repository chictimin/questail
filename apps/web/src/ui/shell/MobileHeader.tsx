/** U4 모바일 헤더 — 3칸 그리드 + 메뉴 가로 스크롤 + translateY(-76px) 숨김(높이 애니메이션 없음). */
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
  const lastY = useRef(0);

  useEffect(() => {
    const onScroll = (): void => {
      const y = window.scrollY;
      setHidden(y > 76 && y > lastY.current);
      lastY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <header className={hidden ? 'mobile-header is-hidden' : 'mobile-header'}>
      <div className="mobile-header-top">
        <img
          className="shell-symbol"
          src={logoUrl}
          alt={text('shell.logoAlt')}
          width={40}
          height={40}
        />
        <Wordmark />
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
