/**
 * Language registry for PRIMESTACK POS.
 * Every entry is a selectable UI language for the merchant dashboard and the
 * customer portal. `dir` drives `document.documentElement.dir` (RTL support).
 */

export type LanguageDir = "ltr" | "rtl";

export interface LanguageMeta {
  /** BCP-47 code used by i18next and stored in localStorage. */
  code: string;
  /** Name of the language in its own script (shown in the switcher). */
  nativeName: string;
  /** English name (shown as secondary label / for search). */
  englishName: string;
  dir: LanguageDir;
  /** Flag emoji used purely as a visual hint in the switcher. */
  flag: string;
}

export const LANGUAGES: LanguageMeta[] = [
  { code: "en", nativeName: "English", englishName: "English", dir: "ltr", flag: "🇬🇧" },
  { code: "fr", nativeName: "Français", englishName: "French", dir: "ltr", flag: "🇫🇷" },
  { code: "de", nativeName: "Deutsch", englishName: "German", dir: "ltr", flag: "🇩🇪" },
  { code: "he", nativeName: "עברית", englishName: "Hebrew", dir: "rtl", flag: "🇮🇱" },
  { code: "ar", nativeName: "العربية", englishName: "Arabic", dir: "rtl", flag: "🇦🇪" },
  { code: "hi", nativeName: "हिन्दी", englishName: "Hindi", dir: "ltr", flag: "🇮🇳" },
  { code: "ml", nativeName: "മലയാളം", englishName: "Malayalam", dir: "ltr", flag: "🇮🇳" },
  { code: "ta", nativeName: "தமிழ்", englishName: "Tamil", dir: "ltr", flag: "🇮🇳" },
  { code: "te", nativeName: "తెలుగు", englishName: "Telugu", dir: "ltr", flag: "🇮🇳" },
  { code: "kn", nativeName: "ಕನ್ನಡ", englishName: "Kannada", dir: "ltr", flag: "🇮🇳" },
  { code: "bn", nativeName: "বাংলা", englishName: "Bengali", dir: "ltr", flag: "🇧🇩" },
  { code: "mr", nativeName: "मराठी", englishName: "Marathi", dir: "ltr", flag: "🇮🇳" },
  { code: "gu", nativeName: "ગુજરાતી", englishName: "Gujarati", dir: "ltr", flag: "🇮🇳" },
  { code: "pa", nativeName: "ਪੰਜਾਬੀ", englishName: "Punjabi", dir: "ltr", flag: "🇮🇳" },
  { code: "ur", nativeName: "اردو", englishName: "Urdu", dir: "rtl", flag: "🇵🇰" },
  { code: "es", nativeName: "Español", englishName: "Spanish", dir: "ltr", flag: "🇪🇸" },
  { code: "pt", nativeName: "Português", englishName: "Portuguese", dir: "ltr", flag: "🇵🇹" },
  { code: "it", nativeName: "Italiano", englishName: "Italian", dir: "ltr", flag: "🇮🇹" },
  { code: "nl", nativeName: "Nederlands", englishName: "Dutch", dir: "ltr", flag: "🇳🇱" },
  { code: "ru", nativeName: "Русский", englishName: "Russian", dir: "ltr", flag: "🇷🇺" },
  { code: "uk", nativeName: "Українська", englishName: "Ukrainian", dir: "ltr", flag: "🇺🇦" },
  { code: "pl", nativeName: "Polski", englishName: "Polish", dir: "ltr", flag: "🇵🇱" },
  { code: "ro", nativeName: "Română", englishName: "Romanian", dir: "ltr", flag: "🇷🇴" },
  { code: "el", nativeName: "Ελληνικά", englishName: "Greek", dir: "ltr", flag: "🇬🇷" },
  { code: "cs", nativeName: "Čeština", englishName: "Czech", dir: "ltr", flag: "🇨🇿" },
  { code: "sv", nativeName: "Svenska", englishName: "Swedish", dir: "ltr", flag: "🇸🇪" },
  { code: "tr", nativeName: "Türkçe", englishName: "Turkish", dir: "ltr", flag: "🇹🇷" },
  { code: "fa", nativeName: "فارسی", englishName: "Persian", dir: "rtl", flag: "🇮🇷" },
  { code: "zh", nativeName: "中文", englishName: "Chinese", dir: "ltr", flag: "🇨🇳" },
  { code: "ja", nativeName: "日本語", englishName: "Japanese", dir: "ltr", flag: "🇯🇵" },
  { code: "ko", nativeName: "한국어", englishName: "Korean", dir: "ltr", flag: "🇰🇷" },
  { code: "id", nativeName: "Bahasa Indonesia", englishName: "Indonesian", dir: "ltr", flag: "🇮🇩" },
  { code: "ms", nativeName: "Bahasa Melayu", englishName: "Malay", dir: "ltr", flag: "🇲🇾" },
  { code: "vi", nativeName: "Tiếng Việt", englishName: "Vietnamese", dir: "ltr", flag: "🇻🇳" },
  { code: "th", nativeName: "ไทย", englishName: "Thai", dir: "ltr", flag: "🇹🇭" },
  { code: "sw", nativeName: "Kiswahili", englishName: "Swahili", dir: "ltr", flag: "🇰🇪" },
  { code: "fil", nativeName: "Filipino", englishName: "Filipino", dir: "ltr", flag: "🇵🇭" },
];

export const DEFAULT_LANGUAGE = "en";
export const LANGUAGE_STORAGE_KEY = "pos_language";

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export const getLanguage = (code: string | null | undefined): LanguageMeta =>
  (code && BY_CODE.get(code)) || BY_CODE.get(DEFAULT_LANGUAGE)!;

export const isRtl = (code: string | null | undefined): boolean =>
  getLanguage(code).dir === "rtl";

/** Sorted copy for rendering the switcher (native name, locale-aware). */
export const sortedLanguages = (): LanguageMeta[] =>
  [...LANGUAGES].sort((a, b) => a.englishName.localeCompare(b.englishName));
