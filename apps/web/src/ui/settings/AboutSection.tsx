/**
 * U5-[2] 설정 정보 섹션 — 버전(API) + MIT(정적). 자체 조회.
 */
import { useEffect, useState } from 'react';
import { useLocale } from '../i18n/context.js';
import './settings.css';

export function AboutSection(): React.JSX.Element {
  const { text } = useLocale();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const response = await fetch('/api/settings/info');
        if (!response.ok) {
          return;
        }
        const body = (await response.json()) as { version?: unknown };
        if (!cancelled && typeof body.version === 'string') {
          setVersion(body.version);
        }
      } catch {
        // 조회 실패는 버전 행 생략.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-labelledby="settings-about-heading">
      <h2 id="settings-about-heading">{text('settings.aboutTitle')}</h2>
      <div className="settings-row">
        <span className="settings-label">{text('settings.versionLabel')}</span>
        <div className="settings-body">
          <code>{version ?? '—'}</code>
          <p>{text('connect.valveNotice')}</p>
          <span>{text('settings.licenseLabel')}</span>
        </div>
      </div>
    </section>
  );
}
