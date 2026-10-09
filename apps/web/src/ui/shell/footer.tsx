/** W5-UI 공통 셸 — 푸터 고지. 문구는 ④에서 디자인 원문으로 교체한다. */
import { useLocale } from '../i18n/context.js';
import { STEAM_LINKS } from '../connectLinks.js';
import './shell.css';

export function SiteFooter(): React.JSX.Element {
  const { text } = useLocale();
  return (
    <footer className="site-footer">
      <p>{text('connect.valveNotice')}</p>
      <p>
        <a className="site-footer-link" href={STEAM_LINKS.store}>
          {text('shell.storeLink')}
        </a>
      </p>
    </footer>
  );
}
