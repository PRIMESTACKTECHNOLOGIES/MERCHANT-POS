import { useEffect, useRef } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { clearCustomerSession, getCustomerProfile } from "../lib/customerApi";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

/** Sign the customer out automatically after this much inactivity. */
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
/** User interactions that count as "activity" and reset the idle timer. */
const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "scroll", "mousemove"] as const;

/** `label` is a key inside the `portal` namespace of the locale files. */
const NAV = [
  { to: "/portal/overview", label: "overview", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { to: "/portal/send", label: "send", icon: "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" },
  { to: "/portal/receive", label: "receive", icon: "M12 3v13m0 0l-4-4m4 4l4-4M4 21h16" },
  { to: "/portal/processor", label: "processor", icon: "M4 4h16v6H4zM4 14h16v6H4zM7 7h4M7 17h4" },
  { to: "/portal/c2m", label: "c2m", icon: "M3 21V7l6 4 6-4v10l6-4v8z" },
  { to: "/portal/profile", label: "profile", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM4 21a8 8 0 0116 0" },
];

function NavIcon({ path }: { path: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d={path} />
    </svg>
  );
}

export function CustomerPortalLayout() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const profile = getCustomerProfile();
  const idleTimer = useRef<number | null>(null);

  const handleLogout = () => {
    clearCustomerSession();
    navigate("/portal/login", { replace: true });
  };

  // Auto sign-out after a period of inactivity, so a shared/public phone left
  // unattended does not keep the customer's wallet session open.
  useEffect(() => {
    let lastReset = 0;
    const reset = () => {
      const now = Date.now();
      if (now - lastReset < 1000) return; // throttle high-frequency move events
      lastReset = now;
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(handleLogout, IDLE_TIMEOUT_MS);
    };

    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, reset, { passive: true }));
    reset();

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, reset));
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayName = profile?.name || t("portal.customer");
  const walletCode = profile?.wallet_code || "";

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <header className="bg-slate-900 text-white px-3 sm:px-4 lg:px-8 h-14 sm:h-16 flex items-center justify-between shadow shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-blue-600 flex items-center justify-center font-bold shrink-0">C</div>
          <div className="leading-tight min-w-0">
            <div className="text-sm font-semibold truncate">{t("auth.customerPortalTitle")}</div>
            <div className="text-[11px] text-slate-400 truncate">{t("portal.personalWalletAccess")}</div>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-3 shrink-0">
          <LanguageSwitcher variant="icon" className="text-slate-300 hover:bg-slate-800" />
          <div className="text-right leading-tight hidden sm:block">
            <div className="text-sm font-medium">{displayName}</div>
            {walletCode && <div className="text-[11px] text-slate-400 font-mono">{walletCode}</div>}
          </div>
          <button
            onClick={handleLogout}
            className="text-xs sm:text-sm px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 transition whitespace-nowrap"
          >
            {t("portal.signOut")}
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Desktop / tablet rail */}
        <aside className="hidden md:flex w-16 lg:w-56 bg-white border-r border-slate-200 flex-col py-4 gap-1 shrink-0">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `mx-2 flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                  isActive ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
                }`
              }
            >
              <NavIcon path={item.icon} />
              <span className="hidden lg:inline">{t(`portal.${item.label}`)}</span>
            </NavLink>
          ))}
        </aside>

        <main className="flex-1 min-w-0 p-3 sm:p-4 lg:p-8 pb-24 md:pb-8 lg:pb-8 overflow-x-hidden">
          <Outlet />
        </main>
      </div>

      {/* Phone bottom navigation — keeps every route reachable with a thumb. */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-slate-200 flex"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex-1 min-w-0 px-1 flex flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition ${
                isActive ? "text-blue-700" : "text-slate-500"
              }`
            }
          >
            <NavIcon path={item.icon} />
            {/* Six tabs on a phone: truncate instead of overflowing the bar. */}
            <span className="leading-none w-full text-center truncate">{t(`portal.${item.label}`)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
