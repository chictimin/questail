/** W5-UI 공통 셸 — 푸터 고지. 문구는 ④에서 디자인 원문으로 교체한다. */
import { useLocale } from '../i18n/context.js';
import { STEAM_LINKS } from '../connectLinks.js';

export function SiteFooter(): React.JSX.Element {
  const { text } = useLocale();
  return (
    <footer>
      <p>{text('connect.valveNotice')}</p>
      <p>
        <a href={STEAM_LINKS.store}>{text('shell.storeLink')}</a>
      </p>
    </footer>
  );
}
