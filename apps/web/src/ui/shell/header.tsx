/** W5-UI 공통 셸 — 로고 전용 헤더(미연동·확인 중). */
import { Link, useLocation } from 'wouter';
import { useLocale } from '../i18n/context.js';
import logoUrl from '../../assets/logo-mark.png';
import { Wordmark } from './Wordmark.js';
import { SHELL_MENU } from './menu.js';
import './shell.css';

export function LogoHeader(): React.JSX.Element {
  const { text } = useLocale();
  return (
    <header>
      <img src={logoUrl} alt={text('shell.logoAlt')} />
    </header>
  );
}

/** U4 연동 후 헤더 — 워드마크 + 메뉴 4(아이콘+활성) + 심볼. 요약 pill은 자리만(미렌더). */
export function Header(): React.JSX.Element {
  const { text } = useLocale();
  const [path] = useLocation();
  return (
    <header className="site-header">
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
