/**
 * W14 로케일 컨텍스트 — LocaleStore 주입 + t() 바인딩. 저장은 A 몫이라 스텁만 둔다.
 */
import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import {
  memoryLocaleStore,
  resolveLocale,
  t,
  type Locale,
  type LocaleStore,
} from './index.js';

type LocaleValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  text: (
    key: Parameters<typeof t>[1],
    params?: Parameters<typeof t>[2],
  ) => string;
};

const LocaleContext = createContext<LocaleValue | null>(null);

export function LocaleProvider({
  store,
  language,
  children,
}: {
  store?: LocaleStore;
  language?: string;
  children: ReactNode;
}): React.JSX.Element {
  const [kept] = useState(() => store ?? memoryLocaleStore());
  const [locale, setLocaleState] = useState<Locale>(() =>
    resolveLocale(kept, language ?? navigator.language),
  );
  const setLocale = (next: Locale): void => {
    kept.set(next);
    setLocaleState(next);
  };
  return (
    <LocaleContext.Provider
      value={{ locale, setLocale, text: (key, params) => t(locale, key, params) }}
    >
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleValue {
  const value = useContext(LocaleContext);
  if (value === null) {
    throw new Error('useLocale는 LocaleProvider 안에서만 쓴다');
  }
  return value;
}
