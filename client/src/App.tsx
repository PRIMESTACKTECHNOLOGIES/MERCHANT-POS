import { Routes, Route, Navigate, useLocation, Outlet } from "react-router-dom";
import { DashboardLayout } from "./layouts/DashboardLayout";
import { OverviewPage } from "./pages/OverviewPage";
import { NotificationProvider } from "./contexts/NotificationProvider";
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
import { WalletsPage } from "./pages/WalletsPage";
import { WalletTransferPage } from "./pages/WalletTransferPage";
import { VerifyTransactionPage } from "./pages/VerifyTransactionPage";
import { HotWalletPage } from "./pages/HotWalletPage";
import { MerchantWalletPage } from "./pages/MerchantWalletPage";
import { CustomerFundsPage } from "./pages/CustomerFundsPage";
import { VaultDashboardPage } from "./pages/VaultDashboardPage";
import CustomerWalletPage from "./pages/CustomerWalletPage";
import CustomerWalletProfilePage from "./pages/CustomerWalletProfilePage";
import { CustomerEntryPage } from "./pages/CustomerEntryPage";
import { POSPageSecure } from "./pages/POSPageSecure";
import { LoginPage } from "./pages/LoginPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { Toast } from "./components/Toast";

import type { ReactElement } from "react";
const BYPASS_AUTH = false;
const IS_VAULT_BANK_DASHBOARD = import.meta.env.VITE_APP_MODE === "vault-bank";

function ProtectedRoute({ children }: { children: ReactElement }) {
  const token = localStorage.getItem("token") || localStorage.getItem("jwt_token");
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
  if (IS_VAULT_BANK_DASHBOARD) {
    return (
      <NotificationProvider>
        <Toast />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/vault-bank"
            element={
              <ProtectedRoute>
                <main className="min-h-screen bg-slate-50 p-4 lg:p-8">
                  <VaultDashboardPage />
                </main>
              </ProtectedRoute>
            }
          />
          <Route
            path="/customer-wallet-profile/:customerId"
            element={
              <ProtectedRoute>
                <CustomerWalletProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customer-wallet/:customerId"
            element={
              <ProtectedRoute>
                <CustomerWalletPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="*"
            element={
              <ProtectedRoute>
                <main className="min-h-screen bg-slate-50 p-4 lg:p-8">
                  <VaultDashboardPage />
                </main>
              </ProtectedRoute>
            }
          />
        </Routes>
      </NotificationProvider>
    );
  }

  return (
    <NotificationProvider>
      <Toast />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/onboarding" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />

        {/* PUBLIC — full screen for customer, no sidebar */}
        <Route path="/customer-entry" element={<CustomerEntryPage />} />

        <Route
          path="/vault-bank"
          element={
            <ProtectedRoute>
              <main className="min-h-screen bg-slate-50 p-4 lg:p-8">
                <VaultDashboardPage />
              </main>
            </ProtectedRoute>
          }
        />
        
        {/* Protected Dashboard Routes with Layout */}
        <Route element={<ProtectedRoute><DashboardLayoutWrapper /></ProtectedRoute>}>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/pos" element={<POSPageSecure />} />
          <Route path="/pos-secure" element={<POSPageSecure />} />
          <Route path="/payment-processor" element={<POSPageSecure />} />
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
          <Route path="/wallet-transfer" element={<WalletTransferPage />} />
          <Route path="/verify-transaction" element={<VerifyTransactionPage />} />
          <Route path="/customer-wallet/:customerId" element={<CustomerWalletPage />} />
          <Route path="/customer-wallet-profile/:customerId" element={<CustomerWalletProfilePage />} />
          <Route path="/hot-wallet" element={<HotWalletPage />} />
          <Route path="/customer-funds" element={<CustomerFundsPage />} />
          <Route path="/merchant-wallet" element={<MerchantWalletPage />} />
          <Route path="/wallet" element={<Navigate to="/wallets" replace />} />
          <Route path="/customer-wallet" element={<Navigate to="/wallets" replace />} />
          <Route path="/customer-wallets" element={<Navigate to="/wallets" replace />} />
        </Route>
        
        {/* Catch all - redirect to overview */}
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </NotificationProvider>
  );
}

export default App;
