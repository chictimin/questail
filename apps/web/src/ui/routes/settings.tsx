/** W14 빈 자리 — 설정 화면. 내용은 이후 태스크에서 채운다. */
import { useLocale } from '../i18n/context.js';

export function SettingsPage(): React.JSX.Element {
  const { text } = useLocale();
  return (
    <main data-route="settings">
      <h1>{text('nav.settings')}</h1>
    </main>
  );
}
