"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { formatDate, translate, type Locale, type TranslationParams } from './i18n-core';
export const LANGUAGE_STORAGE_KEY = 'aicd.interface-language';
const eventName = 'aicd-language-changed';
let memoryLocale: Locale = 'vi';
function readLocale(): Locale {
  if (typeof window === 'undefined') return 'vi';
  try { const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY); return saved === 'en' || saved === 'vi' ? saved : memoryLocale; } catch { return memoryLocale; }
}
function subscribe(callback: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) callback(); };
  window.addEventListener(eventName, callback); window.addEventListener('storage', storage);
  return () => { window.removeEventListener(eventName, callback); window.removeEventListener('storage', storage); };
}
type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: (text: string, params?: TranslationParams) => string; date: (value: string) => string };
const LocaleContext = createContext<LocaleContextValue | null>(null);
export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribe, readLocale, () => 'vi' as Locale);
  const setLocale = useCallback((next: Locale) => { memoryLocale = next; try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* Keep an in-memory preference when browser storage is blocked. */ } window.dispatchEvent(new Event(eventName)); }, []);
  const t = useCallback((text: string, params?: TranslationParams) => translate(locale, text, params), [locale]);
  const date = useCallback((value: string) => formatDate(value, locale), [locale]);
  useEffect(() => { document.documentElement.lang = locale; document.title = locale === 'en' ? 'AICD · Import workspace' : 'AICD · Không gian làm việc nhập khẩu'; }, [locale]);
  const value = useMemo(() => ({ locale, setLocale, t, date }), [locale, setLocale, t, date]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
export function useLocale(): LocaleContextValue { const value = useContext(LocaleContext); if (!value) throw new Error('useLocale must be inside LocaleProvider'); return value; }
