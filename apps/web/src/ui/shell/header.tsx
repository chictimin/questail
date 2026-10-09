/** W5-UI 공통 셸 — 로고 전용 헤더(미연동·확인 중). */
import { useLocale } from '../i18n/context.js';
import logoUrl from '../../assets/logo-mark.png';

export function LogoHeader(): React.JSX.Element {
  const { text } = useLocale();
  return (
    <header>
      <img src={logoUrl} alt={text('shell.logoAlt')} />
    </header>
  );
}
