/** W8 설정 화면 — 연결 + 업적 토글 + 표시 언어 + 정보 조립. */
import { useLocale } from '../i18n/context.js';
import { Connection } from '../settings/Connection.js';
import { AboutSection } from '../settings/AboutSection.js';
import { Achievements } from '../settings/Achievements.js';
import { Language } from '../settings/Language.js';

export function SettingsPage(): React.JSX.Element {
  const { text } = useLocale();
  return (
    <main data-route="settings">
      <h1>{text('nav.settings')}</h1>
      <Connection />
      <Achievements />
      <Language />
      <AboutSection />
    </main>
  );
}
