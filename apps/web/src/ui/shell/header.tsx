/** W0 공통 셸 — 로고 전용 헤더(미연동). 메뉴·요약 없음. */
import { Link, useLocation } from 'wouter';
import { useLocale } from '../i18n/context.js';
import logoUrl from '../../assets/logo-mark.png';
import { Wordmark } from './Wordmark.js';
import { SHELL_MENU } from './menu.js';
import { SummaryPill } from './SummaryPill.js';
import './shell.css';

export function LogoHeader(): React.JSX.Element {
  const { text } = useLocale();
  return (
    <header className="site-header site-header--guest">
      <Wordmark />
      <span className="site-header-spacer" aria-hidden="true" />
      <img
        className="shell-symbol"
        src={logoUrl}
        alt={text('shell.logoAlt')}
        width={40}
        height={40}
      />
    </header>
  );
}

/** W0 연동 후 헤더 — 워드마크 + 메뉴 4 + spacer + 수집 요약 + 심볼. */
export function Header(): React.JSX.Element {
  const { text } = useLocale();
  const [path] = useLocation();
  return (
    <header className="site-header site-header--app">
      <Wordmark />
      <nav className="site-menu">
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
      <span className="site-header-spacer" aria-hidden="true" />
      <SummaryPill />
      <img
        className="shell-symbol"
        src={logoUrl}
        alt={text('shell.logoAlt')}
        width={40}
        height={40}
      />
    </header>
  );
}
