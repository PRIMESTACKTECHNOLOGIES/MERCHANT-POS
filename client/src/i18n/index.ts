import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  getLanguage,
} from "./languages";

// Every locale file under ./locales is bundled eagerly. Missing files simply
// fall back to English, so the app stays usable while translations are added.
const modules = import.meta.glob<{ default: Record<string, unknown> }>(
  "./locales/*.json",
  { eager: true }
);

const resources: Record<string, { translation: Record<string, unknown> }> = {};
for (const [path, mod] of Object.entries(modules)) {
  const code = path.replace("./locales/", "").replace(".json", "");
  resources[code] = { translation: (mod.default ?? mod) as Record<string, unknown> };
}

export const readStoredLanguage = (): string => {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored && getLanguage(stored).code === stored) return stored;
  } catch {
    /* localStorage unavailable (private mode / SSR) */
  }
  return DEFAULT_LANGUAGE;
};

/** Apply lang + dir to <html>. Called on init and on every language change. */
export const applyDocumentLanguage = (code: string): void => {
  const meta = getLanguage(code);
  const root = document.documentElement;
  root.setAttribute("lang", meta.code);
  root.setAttribute("dir", meta.dir);
  root.classList.toggle("rtl", meta.dir === "rtl");
};

void i18n.use(initReactI18next).init({
  resources,
  lng: readStoredLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: Object.keys(resources).length ? Object.keys(resources) : [DEFAULT_LANGUAGE],
  interpolation: { escapeValue: false },
  returnNull: false,
});

applyDocumentLanguage(i18n.language || DEFAULT_LANGUAGE);

i18n.on("languageChanged", (lng) => {
  applyDocumentLanguage(lng);
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch {
    /* ignore quota / private mode */
  }
});

/** Programmatic language switch used by the LanguageSwitcher. */
export const changeLanguage = (code: string): Promise<unknown> => i18n.changeLanguage(code);

export default i18n;
