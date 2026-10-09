/** W5-UI 공통 셸 — 내비게이션 헤더(연동 후). */
import { Link } from 'wouter';
import { useLocale } from '../i18n/context.js';

export function NavHeader(): React.JSX.Element {
  const { text } = useLocale();
  return (
    <header>
      <nav>
        <Link href="/connect">{text('nav.connect')}</Link>
        <Link href="/sync">{text('nav.sync')}</Link>
        <Link href="/library">{text('nav.library')}</Link>
        <Link href="/settings">{text('nav.settings')}</Link>
        <Link href="/export">{text('nav.export')}</Link>
      </nav>
    </header>
  );
}
