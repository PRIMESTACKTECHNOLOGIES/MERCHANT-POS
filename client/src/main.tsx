import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./components/ui/Toast";
import { registerAutoSync } from "./lib/offline-sync";
import { installClientSecurityGuard } from "./lib/security-guard";
import "./i18n";
import "./index.css";

// ── Boot-time crash reporter ───────────────────────────────────────────────
// This app mounts no ErrorBoundary and a module-level throw happens BEFORE React
// ever mounts, so both cases previously produced a completely blank page with no
// visible cause (the security guard also hides DevTools by default). This
// reports the real error into #root instead of leaving it empty.
const escapeHtml = (value: string) =>
  value.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));

function renderBootError(title: string, detail: unknown) {
  const root = document.getElementById("root");
  if (!root || root.childElementCount > 0) return;
  const message = detail instanceof Error
    ? `${detail.message}\n\n${detail.stack || ""}`
    : String(detail);
  root.innerHTML =
    '<div style="padding:32px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#0b1120;min-height:100vh">' +
    `<h1 style="color:#f87171;font-size:18px;margin:0 0 12px">${escapeHtml(title)}</h1>` +
    `<pre style="white-space:pre-wrap;background:#1e293b;color:#e2e8f0;padding:16px;border-radius:8px;font-size:13px">${escapeHtml(message)}</pre>` +
    "</div>";
}

window.addEventListener("error", (e) => renderBootError("PRIMESTACK POS — boot error", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => renderBootError("PRIMESTACK POS — unhandled promise rejection", e.reason));

// Install client-side intrusion deterrents + attempt reporting (see lib/security-guard.ts)
installClientSecurityGuard();

// Apply saved theme before first paint (no flash)
const savedTheme = localStorage.getItem('pos_theme');
if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
  document.documentElement.classList.add('dark');
}

// ── GLOBAL WIPE: clears every known POS storage key + sessionStorage + localStorage
//    Usage: open DevTools → Console → type:   window.POS_WIPE_ALL()
declare global {
  interface Window {
    POS_WIPE_ALL?: (confirmStr?: string) => { removed: string[] };
  }
}
(function attachWipeFn() {
  const KNOWN_KEYS = [
    'token','jwt_token','user','settings','merchantConfig','login_session',
    'pos_theme','pos_language','pos_notifications','payment_methods_v2','terminal_currency',
    'dashboard_transactions','offline_transactions','dashboard_last_stan',
    'last_stan','emv_last_stan','emv_offline_queue','emv-offline-transactions',
    'emv-pending-transactions','pos_offline_ops','pos_offline_ledger',
    'pos_offline_wallet_payments','pos_offline_pin_sales','last_card_last4',
    'last_pan_masked','last_card_bin','offlineSecureStorageKey','secureWalletKey'
  ];
  window.POS_WIPE_ALL = (confirmStr?: string) => {
    if (confirmStr !== 'YES' && !confirmStr) {
      console.warn(
        '%c[POS_WIPE_ALL] CONFIRM REQUIRED — re-run with:  POS_WIPE_ALL("YES")\n' +
        'This will delete ALL localStorage / sessionStorage items in this origin.\n' +
        'You will be logged out. No undo.',
        'color:red;font-weight:bold;font-size:13px;'
      );
      return { removed: [] };
    }
    const removed: string[] = [];
    const keysBefore = new Set<string>();
    for (let i = 0; i < localStorage.length; i++) keysBefore.add(localStorage.key(i)!);
    for (let i = 0; i < sessionStorage.length; i++) keysBefore.add(sessionStorage.key(i)!);
    KNOWN_KEYS.forEach(k => {
      if (localStorage.getItem(k) !== null) { localStorage.removeItem(k); removed.push('LS:'+k); }
      if (sessionStorage.getItem(k) !== null) { sessionStorage.removeItem(k); removed.push('SS:'+k); }
    });
    try {
      const lsAll = new Array(localStorage.length).fill(0).map((_,i)=>localStorage.key(i)!);
      lsAll.forEach(k => { if (!removed.includes('LS:'+k)) { localStorage.removeItem(k); removed.push('LS*:'+k); }});
      const ssAll = new Array(sessionStorage.length).fill(0).map((_,i)=>sessionStorage.key(i)!);
      ssAll.forEach(k => { if (!removed.includes('SS:'+k)) { sessionStorage.removeItem(k); removed.push('SS*:'+k); }});
      const indexedDBWithDatabases = window.indexedDB as IDBFactory & {
        databases?: () => Promise<IDBDatabaseInfo[]>;
      };
      if (typeof indexedDBWithDatabases.databases === 'function') {
        indexedDBWithDatabases.databases().then(databases =>
          databases.forEach(database => {
            if (database.name) window.indexedDB.deleteDatabase(database.name);
          })
        );
      }
      if (typeof caches !== 'undefined') {
        caches.keys().then(ks => ks.forEach(k => caches.delete(k).catch(()=>{})));
      }
    } catch {
      // Storage providers may disable enumeration; continue with available data.
    }
    console.log('%c[POS_WIPE_ALL] Removed '+removed.length+' keys. Reloading in 1s.',
      'color:green;font-weight:bold;', removed);
    setTimeout(() => location.reload(), 1000);
    return { removed };
  };
  console.log('%c[POS] Admin wipe helper installed. Run:   POS_WIPE_ALL("YES")',
    'color:#aaa;font-size:11px;');
})();

// Register offline-to-online sync at startup
registerAutoSync((result) => {
  if (result.synced > 0) {
    console.log(`[AutoSync] ✅ ${result.synced} offline operation(s) synced on reconnect`);
  }
});
// alert("Dashboard is starting...");

// ── Root error boundary ────────────────────────────────────────────────────
// Without this, any render-time throw unmounts the entire tree and the operator
// sees a blank page. Surfacing the message makes the failure actionable.
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[main.tsx] Root error boundary caught:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: "ui-monospace, monospace", background: "#0b1120", minHeight: "100vh" }}>
          <h1 style={{ color: "#f87171", fontSize: 18, margin: "0 0 12px" }}>
            PRIMESTACK POS — render error
          </h1>
          <pre style={{ whiteSpace: "pre-wrap", background: "#1e293b", color: "#e2e8f0", padding: 16, borderRadius: 8, fontSize: 13 }}>
            {`${this.state.error.message}\n\n${this.state.error.stack || ""}`}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  console.error("[main.tsx] ERROR: Root element not found!");
} else {
  try {
    ReactDOM.createRoot(rootElement).render(
      <RootErrorBoundary>
        <BrowserRouter>
          <ToastProvider>
            <App />
          </ToastProvider>
        </BrowserRouter>
      </RootErrorBoundary>
    );
    console.log("[main.tsx] App rendered successfully!");
  } catch (error) {
    console.error("[main.tsx] ERROR rendering app:", error);
    rootElement.innerHTML = `
      <div style="padding: 40px; color: red; font-family: sans-serif;">
        <h1>Error Rendering App</h1>
        <pre style="background: #fee; padding: 10px; border-radius: 4px;">${error instanceof Error ? error.message : String(error)}</pre>
        <p>Check the browser console (F12) for more details.</p>
      </div>
    `;
  }
}
