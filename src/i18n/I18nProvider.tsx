import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  I18nContext,
  STORAGE_KEY,
  getStoredLocale,
  translations,
  type I18nContextValue,
  type Locale,
} from "./context";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getStoredLocale);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // localStorage may be unavailable in privacy modes.
    }
  }, []);

  const t = useCallback((key: string) => {
    return translations[locale][key] || translations.en[key] || key;
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    t,
    setLocale,
  }), [locale, t, setLocale]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}
