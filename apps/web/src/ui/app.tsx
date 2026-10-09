/** W14 라우팅 틀 — 경로 기반 4개(wouter). 화면 내용은 빈 자리다. */
import { Link, Route, Switch } from 'wouter';
import { useLocale } from './i18n/context.js';
import { ConnectPage } from './routes/connect.js';
import { SyncPage } from './routes/sync.js';
import { LibraryPage } from './routes/library.js';
import { SettingsPage } from './routes/settings.js';

export const ROUTES = [
  { path: '/connect', Page: ConnectPage },
  { path: '/sync', Page: SyncPage },
  { path: '/library', Page: LibraryPage },
  { path: '/settings', Page: SettingsPage },
] as const;

export function App(): React.JSX.Element {
  const { text } = useLocale();
  return (
    <div>
      <nav>
        <Link href="/connect">{text('nav.connect')}</Link>
        <Link href="/sync">{text('nav.sync')}</Link>
        <Link href="/library">{text('nav.library')}</Link>
        <Link href="/settings">{text('nav.settings')}</Link>
      </nav>
      <Switch>
        <Route path="/connect" component={ConnectPage} />
        <Route path="/sync" component={SyncPage} />
        <Route path="/library" component={LibraryPage} />
        <Route path="/settings" component={SettingsPage} />
      </Switch>
    </div>
  );
}
