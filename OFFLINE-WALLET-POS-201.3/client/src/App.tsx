import { Routes, Route, Navigate, useLocation, Outlet } from "react-router-dom";
import { DashboardLayout } from "./layouts/DashboardLayout";
import { OverviewPage } from "./pages/OverviewPage";
import { NotificationProvider } from "./contexts/NotificationContext";
import { TerminalsPage } from "./pages/TerminalsPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { BatchesPage } from "./pages/BatchesPage";
import { SettlementsPage } from "./pages/SettlementsPage";
import { DeveloperPage } from "./pages/DeveloperPage";
import { InventoryPage } from "./pages/InventoryPage";
import { TerminalPairingPage } from "./pages/TerminalPairingPage";
import { DeviceSecurityPage } from "./pages/DeviceSecurityPage";
import { OfflineTransactionsPage } from "./pages/OfflineTransactionsPage";
import { PaymentMethodsPage } from "./pages/PaymentMethodsPage";
import { ReceiptsPage } from "./pages/ReceiptsPage";
import { POSPage } from "./pages/POSPage";
import { POSPageSecure } from "./pages/POSPageSecure";
import { WalletsPage } from "./pages/WalletsPage";
import { LoginPage } from "./pages/LoginPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import type { ReactElement } from "react";

// TEMPORARY: Bypass auth for testing - REMOVE AFTER FIX
const BYPASS_AUTH = true;

function ProtectedRoute({ children }: { children: ReactElement }) {
  const token = localStorage.getItem("token");
  const location = useLocation();

  // TEMPORARY: Skip auth check
  if (BYPASS_AUTH) {
    return children;
  }

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
}

// Layout wrapper that uses Outlet for nested routes
function DashboardLayoutWrapper() {
  return (
    <DashboardLayout>
      <Outlet />
    </DashboardLayout>
  );
}

function App() {
  return (
    <NotificationProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/onboarding" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />
        
        {/* Protected Dashboard Routes with Layout */}
        <Route element={<ProtectedRoute><DashboardLayoutWrapper /></ProtectedRoute>}>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/pos" element={<POSPage />} />
          <Route path="/pos-secure" element={<POSPageSecure />} />
          <Route path="/terminals" element={<TerminalsPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/batches" element={<BatchesPage />} />
          <Route path="/settlements" element={<SettlementsPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/developer" element={<DeveloperPage />} />
          <Route path="/terminal-pairing" element={<TerminalPairingPage />} />
          <Route path="/device-security" element={<DeviceSecurityPage />} />
          <Route path="/offline-transactions" element={<OfflineTransactionsPage />} />
          <Route path="/payment-methods" element={<PaymentMethodsPage />} />
          <Route path="/receipts" element={<ReceiptsPage />} />
          <Route path="/wallets" element={<WalletsPage />} />
        </Route>
        
        {/* Catch all - redirect to overview */}
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </NotificationProvider>
  );
}

export default App;
