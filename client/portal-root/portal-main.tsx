/**
 * portal-main.tsx — entry point for the PORTAL-ONLY build (vite.portal.config.ts).
 *
 * The customer wallet portal is deployed to Netlify on its own, so this mounts
 * ONLY the /portal/* routes; none of the merchant dashboard is bundled here.
 *
 * Routes deliberately keep the /portal/... prefix so existing links, printed
 * receipts, QR codes and the backend's /portal/* redirect keep working.
 */
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ToastProvider } from "../src/components/ui/Toast";
import { CustomerPortalLayout } from "../src/layouts/CustomerPortalLayout";
import { CustomerLoginPage } from "../src/pages/customer-portal/CustomerLoginPage";
import { CustomerOverviewPage } from "../src/pages/customer-portal/CustomerOverviewPage";
import { CustomerSendPage } from "../src/pages/customer-portal/CustomerSendPage";
import { CustomerReceivePage } from "../src/pages/customer-portal/CustomerReceivePage";
import { CustomerPayPage } from "../src/pages/customer-portal/CustomerPayPage";
import { CustomerC2MPage } from "../src/pages/customer-portal/CustomerC2MPage";
import { CustomerProfilePage } from "../src/pages/customer-portal/CustomerProfilePage";
import { isCustomerLoggedIn } from "../src/lib/customerApi";
import { installClientSecurityGuard } from "../src/lib/security-guard";
import "../src/i18n";
import "../src/index.css";

import type { ReactElement } from "react";

// Report a module-level boot failure instead of leaving a blank page.
window.addEventListener("error", (e) => {
  const root = document.getElementById("root");
  if (!root || root.childElementCount > 0) return;
  const detail = e.error instanceof Error ? `${e.error.message}\n\n${e.error.stack || ""}` : String(e.error || e.message);
  root.innerHTML =
    '<div style="padding:32px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#0b1120;min-height:100vh">' +
    '<h1 style="color:#f87171;font-size:18px;margin:0 0 12px">PRIMESTACK — boot error</h1>' +
    `<pre style="white-space:pre-wrap;background:#1e293b;color:#e2e8f0;padding:16px;border-radius:8px;font-size:13px">${detail.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"))}</pre>` +
    "</div>";
});

installClientSecurityGuard();

// Apply the saved theme before first paint (matches the dashboard behaviour).
const savedTheme = localStorage.getItem("pos_theme");
if (savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
  document.documentElement.classList.add("dark");
}

/** Portal guard — the customer session token is separate from the merchant one. */
function CustomerRoute({ children }: { children: ReactElement }) {
  if (!isCustomerLoggedIn()) {
    return <Navigate to="/portal/login" replace />;
  }
  return children;
}

function PortalApp() {
  return (
    <Routes>
      <Route path="/portal/login" element={<CustomerLoginPage />} />
      <Route
        path="/portal"
        element={
          <CustomerRoute>
            <CustomerPortalLayout />
          </CustomerRoute>
        }
      >
        <Route index element={<Navigate to="/portal/overview" replace />} />
        <Route path="overview" element={<CustomerOverviewPage />} />
        <Route path="send" element={<CustomerSendPage />} />
        <Route path="receive" element={<CustomerReceivePage />} />
        <Route path="pay" element={<CustomerPayPage />} />
        <Route path="c2m" element={<CustomerC2MPage />} />
        <Route path="profile" element={<CustomerProfilePage />} />
      </Route>
      {/* Anything else (including "/") lands on the portal sign-in. */}
      <Route path="*" element={<Navigate to="/portal/login" replace />} />
    </Routes>
  );
}

const rootElement = document.getElementById("root");

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <BrowserRouter>
      <ToastProvider>
        <PortalApp />
      </ToastProvider>
    </BrowserRouter>
  );
} else {
  console.error("[portal-main.tsx] Root element not found");
}
