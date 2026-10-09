/** W14 빈 자리 — 연동 화면. 내용은 W5에서 채운다. */
import { useLocale } from '../i18n/context.js';

export function ConnectPage(): React.JSX.Element {
  const { text } = useLocale();
  return (
    <main data-route="connect">
      <h1>{text('nav.connect')}</h1>
    </main>
  );
}
