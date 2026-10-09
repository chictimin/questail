/** W8 표시 언어 — PUT 성공 뒤 LocaleProvider 전환. 실패하면 유지 + 상태줄. */
import { useState } from 'react';
import { useLocale } from '../i18n/context.js';
import { detectLocale, type Locale } from '../i18n/index.js';

export function Language(): React.JSX.Element {
  const { locale, setLocale, text } = useLocale();
  const [failed, setFailed] = useState(false);
  const [changed, setChanged] = useState(false);
  const [pending, setPending] = useState(false);

  async function change(next: Locale): Promise<void> {
    if (next === locale || pending) return;
    setPending(true);
    setFailed(false);
    setChanged(false);
    try {
      const response = await fetch(
        `/api/prefs?fallback=${detectLocale(navigator.language)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ locale: next }),
        },
      );
      if (!response.ok) {
        throw new Error(`[web] 언어 저장 실패: ${response.status}`);
      }
      setLocale(next);
      setChanged(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="language-heading">
      <h2 id="language-heading">{text('settings.langRow')}</h2>
      <div role="group">
        {(['ko', 'en'] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={locale === candidate}
            disabled={pending}
            onClick={() => void change(candidate)}
          >
            {text(candidate === 'ko' ? 'settings.langKo' : 'settings.langEn')}
          </button>
        ))}
      </div>
      {failed ? <p role="status">{text('settings.saveFailed')}</p> : null}
      {changed ? <p role="status">{text('settings.localeChangedNote')}</p> : null}
    </section>
  );
}
