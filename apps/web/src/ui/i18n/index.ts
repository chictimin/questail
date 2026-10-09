/**
 * W14 i18n 기반 — 사전(ko·en) + t() + 로케일 판정·저장소. 라이브러리 없음.
 * 저장(A 몫)은 LocaleStore 주입 — 지금은 메모리 스텁. C-10 L-6: 미설정 시 브라우저 언어(ko면 ko, 그 외 en).
 */
import { en } from './en.js';
import { ko } from './ko.js';

export type Locale = 'ko' | 'en';
export const LOCALES: Locale[] = ['ko', 'en'];

const dicts = { ko, en } as const;
export type DictKey =
  | keyof typeof ko.nav
  | keyof typeof ko.error
  | keyof typeof ko.export
  | keyof typeof ko.connect
  | keyof typeof ko.library
  | keyof typeof ko.game
  | keyof typeof ko.shell
  | keyof typeof ko.settings;

type Section = 'nav' | 'error' | 'export' | 'connect' | 'library' | 'game' | 'shell' | 'settings';

/** 'nav.connect'·'error.AUTH_INVALID_KEY' 형태 키를 푼다. */
export function t(
  locale: Locale,
  key: `${Section}.${string}`,
  params?: Record<string, string | number>,
): string {
  const [section, name] = key.split('.') as [Section, string];
  const table = dicts[locale][section] as Record<string, string>;
  let text = table[name] ?? key;
  if (params !== undefined) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}

/** 평탄 키 집합 — ko·en 차집합 0 검사 재료. */
export function flatKeys(locale: Locale): string[] {
  const dict = dicts[locale];
  return [
    ...Object.keys(dict.nav).map((k) => `nav.${k}`),
    ...Object.keys(dict.error).map((k) => `error.${k}`),
    ...Object.keys(dict.export).map((k) => `export.${k}`),
    ...Object.keys(dict.connect).map((k) => `connect.${k}`),
    ...Object.keys(dict.library).map((k) => `library.${k}`),
    ...Object.keys(dict.game).map((k) => `game.${k}`),
    ...Object.keys(dict.shell).map((k) => `shell.${k}`),
    ...Object.keys(dict.settings).map((k) => `settings.${k}`),
  ].sort();
}

/** 브라우저 언어 → ko|en (ko로 시작하면 ko, 그 외 en). */
export function detectLocale(language: string | null | undefined): Locale {
  return language !== null &&
    language !== undefined &&
    language.toLowerCase().startsWith('ko')
    ? 'ko'
    : 'en';
}

/** 로케일 저장소 — A 소유 확정 전까지 메모리 스텁. */
export interface LocaleStore {
  get: () => Locale | null;
  set: (locale: Locale) => void;
}

export function memoryLocaleStore(initial: Locale | null = null): LocaleStore {
  let current = initial;
  return {
    get: () => current,
    set: (locale: Locale) => {
      current = locale;
    },
  };
}

/** 저장값, 없으면 브라우저 판정. */
export function resolveLocale(
  store: LocaleStore,
  language: string | null | undefined,
): Locale {
  return store.get() ?? detectLocale(language);
}
