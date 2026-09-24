import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import {
  getSystemSettings,
  type LanguagePreference,
  type SystemSettings,
} from "../lib/api";
import {
  detectSystemLocale,
  intlTag,
  normalizeLanguagePreference,
  readStoredLanguage,
  storeLanguage,
  translate,
  type AppLocale,
  type MessageKey,
} from "../lib/i18n";

interface LocaleContextValue {
  locale: AppLocale;
  preference: LanguagePreference;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export const SETTINGS_EVENT = "abyss-settings";

export function publishSystemSettings(settings: SystemSettings) {
  storeLanguage(normalizeLanguagePreference(settings.language));
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: settings }));
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<LanguagePreference>(readStoredLanguage);
  const [systemLocale, setSystemLocale] = useState<AppLocale>(detectSystemLocale);
  const locale: AppLocale = preference === "system" ? systemLocale : preference;

  const apply = useCallback((next: LanguagePreference) => {
    const normalized = normalizeLanguagePreference(next);
    storeLanguage(normalized);
    setPreference(normalized);
  }, []);

  useEffect(() => {
    document.documentElement.lang = intlTag(locale);
  }, [locale]);

  useEffect(() => {
    const onLanguageChange = () => setSystemLocale(detectSystemLocale());
    window.addEventListener("languagechange", onLanguageChange);
    return () => window.removeEventListener("languagechange", onLanguageChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    function load() {
      getSystemSettings()
        .then((settings) => {
          if (!cancelled) apply(settings.language);
        })
        .catch(() => {
          /* keep the stored or system default */
        });
    }
    load();
    const onSettings = (event: Event) => {
      const detail = (event as CustomEvent<Partial<SystemSettings>>).detail;
      if (detail && "language" in detail && detail.language) apply(detail.language);
    };
    window.addEventListener(SETTINGS_EVENT, onSettings);
    let unlisten: (() => void) | undefined;
    void listen("tray-calendar-shown", () => {
      if (!cancelled) load();
    }).then((fn) => {
      unlisten = fn;
    }).catch(() => {
      /* browser preview */
    });
    return () => {
      cancelled = true;
      window.removeEventListener(SETTINGS_EVENT, onSettings);
      unlisten?.();
    };
  }, [apply]);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) =>
      translate(locale, key, vars),
    [locale],
  );
  const value = useMemo(
    () => ({ locale, preference, t }),
    [locale, preference, t],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) {
    const locale = detectSystemLocale();
    return {
      locale,
      preference: "system",
      t: (key, vars) => translate(locale, key, vars),
    };
  }
  return value;
}
