/** W14 빈 자리 — 별점 리스트 화면. 내용은 W7에서 채운다. */
import { useLocale } from '../i18n/context.js';

export function LibraryPage(): React.JSX.Element {
  const { text } = useLocale();
  return (
    <main data-route="library">
      <h1>{text('nav.library')}</h1>
    </main>
  );
}
