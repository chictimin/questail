/** W0 공통 셸 — 푸터 고지 + Steam 스토어 링크. 문구는 i18n 정본(레퍼런스 원문과 동일). */
import { ArrowUpRight, SteamLogo } from '@phosphor-icons/react';
import { useLocale } from '../i18n/context.js';
import { STEAM_LINKS } from '../connectLinks.js';
import './shell.css';

export function SiteFooter(): React.JSX.Element {
  const { text } = useLocale();
  return (
    <footer className="site-footer">
      <span className="site-footer-notice">{text('connect.valveNotice')}</span>
      <a className="site-footer-link" href={STEAM_LINKS.store} target="_blank" rel="noopener noreferrer">
        <SteamLogo size={15} aria-hidden />
        <span>{text('shell.storeLink')}</span>
        <ArrowUpRight size={12} aria-hidden />
      </a>
    </footer>
  );
}
