/** W14 UI 진입 — createRoot 정상 사용. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import { LocaleProvider } from './i18n/context.js';
import { SyncStatusProvider } from './sync/statusContext.js';
import './styles.css';

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('root 요소 없음');
}
createRoot(rootElement).render(
  <StrictMode>
    <LocaleProvider>
      <SyncStatusProvider>
        <App />
      </SyncStatusProvider>
    </LocaleProvider>
  </StrictMode>,
);
