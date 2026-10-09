/** W8 설정 화면 — 업적 토글 + 표시 언어 조립. */
import { useLocale } from '../i18n/context.js';
import { Achievements } from '../settings/Achievements.js';
import { Language } from '../settings/Language.js';

export function SettingsPage(): React.JSX.Element {
  const { text } = useLocale();
  return (
    <main data-route="settings">
      <h1>{text('nav.settings')}</h1>
      <Achievements />
      <Language />
    </main>
  );
}
