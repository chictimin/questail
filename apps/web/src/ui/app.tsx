/**
 * W5-UI 앱 셸 — 미연동이면 /connect로 리다이렉트 + 로고 헤더, 연동 후 nav 헤더.
 * 상태 확인 실패 시 fail-open(리다이렉트 안 함). 68px 레일·수집 요약은 범위 밖.
 */
import { useEffect, useState } from 'react';
import { Redirect, Route, Switch, useLocation } from 'wouter';
import { ConnectPage } from './routes/connect.js';
import { SyncPage } from './routes/sync.js';
import { LibraryPage } from './routes/library.js';
import { SettingsPage } from './routes/settings.js';
import { ExportPage } from './routes/export.js';
import { LogoHeader } from './shell/header.js';
import { NavHeader } from './shell/navHeader.js';
import { SiteFooter } from './shell/footer.js';

export const ROUTES = [
  { path: '/connect', Page: ConnectPage },
  { path: '/sync', Page: SyncPage },
  { path: '/library', Page: LibraryPage },
  { path: '/settings', Page: SettingsPage },
  { path: '/export', Page: ExportPage },
] as const;

/** true=연동·false=미연동·null=미확인(fail-open). */
function useConnected(): boolean | null {
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const response = await fetch('/api/connect/status');
        if (!response.ok) {
          // fail-open: 상태 확인 실패는 미확인으로 두고 리다이렉트 안 함
          if (!cancelled) {
            setConnected(null);
          }
          return;
        }
        const body = (await response.json()) as { connected?: unknown };
        if (!cancelled) {
          setConnected(body.connected === true);
        }
      } catch {
        if (!cancelled) {
          setConnected(null);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);
  return connected;
}

export function App(): React.JSX.Element {
  const [path] = useLocation();
  const connected = useConnected();
  if (connected === false && path !== '/connect') {
    return <Redirect to="/connect" />;
  }
  const header =
    connected === true ? (
      <NavHeader />
    ) : (
      <LogoHeader />
    );
  return (
    <div>
      {header}
      <Switch>
        <Route path="/connect" component={ConnectPage} />
        <Route path="/sync" component={SyncPage} />
        <Route path="/library" component={LibraryPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/export" component={ExportPage} />
      </Switch>
      <SiteFooter />
    </div>
  );
}
