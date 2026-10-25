import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGES, getLanguage } from "../i18n/languages";
import { changeLanguage } from "../i18n";

interface Props {
  /** "sidebar" renders a full-width row; "icon" renders a compact header button. */
  variant?: "sidebar" | "icon";
  /** Extra classes for the trigger. */
  className?: string;
}

const GlobeIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className="h-5 w-5 shrink-0"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.6}
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.9 5.7 3.9 9s-1.4 6.4-3.9 9c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3z" />
  </svg>
);

export const LanguageSwitcher = ({ variant = "sidebar", className = "" }: Props) => {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const current = getLanguage(i18n.language);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...LANGUAGES].sort((a, b) => a.englishName.localeCompare(b.englishName));
    if (!q) return list;
    return list.filter(
      (l) =>
        l.englishName.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q)
    );
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const select = (code: string) => {
    void changeLanguage(code);
    setOpen(false);
    setQuery("");
  };

  const panel = open && (
    <div
      className="language-panel absolute z-50 w-72 max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-2xl"
      role="listbox"
      aria-label={t("shell.header.changeLanguage")}
      style={variant === "sidebar" ? { bottom: "calc(100% + 8px)", left: 0 } : { top: "calc(100% + 8px)" }}
    >
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 p-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("shell.header.searchLanguage")}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-base sm:text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-50"
        />
      </div>
      <ul className="py-1">
        {filtered.map((l) => {
          const active = l.code === current.code;
          return (
            <li key={l.code}>
              <button
                type="button"
                onClick={() => select(l.code)}
                role="option"
                aria-selected={active}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-blue-50 ${
                  active ? "bg-blue-50 font-semibold text-blue-700" : "text-gray-700"
                }`}
              >
                <span className="text-base leading-none">{l.flag}</span>
                <span className="flex-1 truncate">
                  {l.nativeName}
                  <span className="ml-2 text-xs text-gray-400">{l.englishName}</span>
                </span>
                {active && (
                  <svg className="h-4 w-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 111.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="px-3 py-4 text-center text-sm text-gray-400">{t("common.noData")}</li>
        )}
      </ul>
    </div>
  );

  if (variant === "icon") {
    return (
      <div className="relative" ref={boxRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={t("shell.header.changeLanguage")}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`flex items-center gap-1.5 rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100 ${className}`}
        >
          <GlobeIcon />
          <span className="hidden text-xs font-semibold uppercase sm:inline">{current.code}</span>
        </button>
        {panel}
      </div>
    );
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 ${className}`}
      >
        <GlobeIcon />
        <span className="flex-1 truncate text-left">
          <span className="block font-medium text-gray-700">{t("shell.header.language")}</span>
          <span className="block text-xs text-gray-400">
            {current.flag} {current.nativeName}
          </span>
        </span>
        <svg className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M5.3 7.3a1 1 0 011.4 0L10 10.6l3.3-3.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 010-1.4z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {panel}
    </div>
  );
};

export default LanguageSwitcher;
