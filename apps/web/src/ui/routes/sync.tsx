/** W14 빈 자리 — 수집 진행·실패 안내 화면. 내용은 W6에서 채운다. */
import { useLocale } from '../i18n/context.js';

export function SyncPage(): React.JSX.Element {
  const { text } = useLocale();
  return (
    <main data-route="sync">
      <h1>{text('nav.sync')}</h1>
    </main>
  );
}
