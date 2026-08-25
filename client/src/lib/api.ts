import { generateHmacSignature } from './crypto';
import { resolveApiBaseUrl } from './backendUrl';

const BASE_URL = resolveApiBaseUrl({
  envValue: import.meta.env.VITE_API_URL,
  currentOrigin: window.location.origin,
});

export interface Terminal {
  id: string;
  merchantId: string;
  terminalId: string;
  name: string;
  offlineEnabled: boolean;
  lastBatchAt?: string | null;
}

export interface Transaction {
  id: string;
  merchantId: string;
  terminalId: string;
  batchId?: string;
  localTxnId?: string;
  stan?: string;
  amountMinor: number;
  currency: string;
  panMasked?: string;
  txnType?: string;
  authMode?: string;
  entryMode?: string;
  rrn?: string;
  authCode?: string;
  status: string;
  emvData?: unknown;
  txnTimestamp: string;
  cardBrand?: string;
  invoiceId?: string;
  paymentId?: string;
  paymentMethod?: "card" | "wallet" | "code";
  customerId?: string;
  walletTransactionId?: string;
}

export interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  created_at: string;
  updated_at: string;
  wallet_id?: string;
  wallet_code?: string;
  wallet_balance?: number;
}

export interface WalletBalance {
  balance: number;
  currency: string;
}

export interface WalletTransaction {
  id: string;
  wallet_id: string;
  type: "credit" | "debit";
  amount: number;
  source: string;
  reference?: string;
  description?: string;
  created_at: string;
}

export interface OfflineWalletPayment {
  id: string;
  customerId: string;
  amount: number;
  currency: string;
  stan: string;
  terminalId: string;
  merchantId: string;
  timestamp: number;
  synced: boolean;
  syncError?: string;
}

// New wallet system interfaces
export interface CryptoWallet { id: string; customer_id: string; crypto_coin: string; balance: number; status: string; created_at: string; }
export interface CryptoTransaction { id: string; customer_id: string; crypto_coin: string; transaction_type: string; fiat_amount: number; crypto_amount: number; fiat_currency: string; exchange_rate: number; status: string; created_at: string; }
export interface BankAccount { id: string; customer_id: string; bank_name: string; account_holder: string; account_number: string; routing_number?: string; iban?: string; swift_code?: string; currency: string; is_default: number; created_at: string; }
export interface BankPayout { id: string; amount: number; fee: number; net_amount: number; status: string; reference: string; bank_name: string; account_number: string; created_at: string; }
export interface WalletTransfer { success: boolean; transferId: string; reference: string; amount: number; }

export interface MerchantWallet {
  id: string;
  merchant_id: string;
  balance: number;
  currency: string;
  created_at?: string;
  updated_at?: string;
}

export interface MerchantWalletTransaction {
  id: string;
  wallet_id: string;
  type: "credit" | "debit";
  amount: number;
  source: string;
  reference?: string;
  description?: string;
  created_at: string;
}

export interface BankTransferTransaction {
  id: string;
  merchantId: string;
  quoteId: string;
  virtualAccountId: string;
  amount: number;
  currency: string;
  status: string;
  userEmail?: string;
  accountDetails?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Batch {
  id: string;
  merchantId: string;
  terminalId: string;
  status: string;
  txnCount?: number;
  totalAmountMinor?: number;
  settlementCode?: string;
  uploadTimestamp: string;
  protocolVersion?: string;
  terminalName?: string;
  transactionCount?: number;
  approvedCount?: number;
  declinedCount?: number;
  batchSeq?: number;
}

export interface Product {
  id: string;
  merchantId: string;
  sku?: string;
  name: string;
  price_minor: number;
  stock: number;
  updated_at?: string;
}

export interface Settings {
  merchant_id: string;
  api_key: string;
  webhook_url: string;
  merchant_name: string;
  support_email: string;
  merchant_address?: string;
  merchant_phone?: string;
  license_number?: string;
  tax_id?: string;
  paypal_client_id: string;
  paypal_client_secret: string;
  paymentConfig?: Array<Record<string, unknown>>;
  terminal_id?: string;
}

export interface Receipt {
  receiptId: string;
  transactionId: string;
  generatedAt: string;
  stan: string;
  amount: string;
  currency: string;
  cardMasked: string;
  status: string;
  merchantInfo?: {
    name: string;
    address: string;
    id: string;
  };
  transaction?: {
    terminalId: string;
    date: string;
    settlementCode?: string;
  };
  footer?: string;
}

type ApiErrorPayload = { error?: string; message?: string };

function getAuthHeader() {
  const token = localStorage.getItem("token");
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const headers = {
    ...options.headers,
    ...getAuthHeader(),
    "Content-Type": "application/json",
  } as HeadersInit;

  try {
    const res = await fetch(url, { ...options, headers });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let errorMessage = res.statusText || "Request failed";
      try {
        const json = JSON.parse(text || "{}");
        if (json?.error) {
          errorMessage = json.error;
        }
      } catch {
        if (text) {
          errorMessage = text;
        }
      }

      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem("token");
        window.location.href = "/login";
      }

      throw new Error(`${errorMessage} (${res.status})`);
    }

    return res;
  } catch (error: unknown) {
    // Network error or other fetch issue
    const message = error instanceof Error ? error.message : "Network error";
    throw new Error(message);
  }
}

export async function login(username: string, password: string) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Login failed");
  }
  const data = await res.json();
  if (data?.token) localStorage.setItem("jwt_token", data.token);
  return data;
}

/**
 * Public, NO-AUTH health check. Use this for the dashboard "online indicator" dot.
 * Returns `{ status: 'ok', timestamp }` on success. Throws if server DOWN or
 * network unreachable. Never triggers 401 "Missing token" because it hits the
 * public `/api/health` endpoint BEFORE the `authenticateToken` middleware.
 */
export async function checkBackendHealth(timeoutMs = 3000): Promise<{ status: string; timestamp: string; }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}/api/health`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Health HTTP ${res.status}`);
    const body = await res.json() as any;
    if (!body || body.status !== 'ok') throw new Error('Health status not ok');
    return { status: String(body.status), timestamp: String(body.timestamp || new Date().toISOString()) };
  } finally {
    clearTimeout(t);
  }
}

export async function fetchTerminals(): Promise<Terminal[]> {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/terminals`);
  return res.json();
}

export async function fetchTransactions(): Promise<Transaction[]> {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/transactions`);
  if (!res.ok) {
    throw new Error("Failed to fetch transactions");
  }
  return res.json();
}

export async function registerTerminal(name: string) {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/terminal/register`, {
    method: "POST",
    body: JSON.stringify({ terminalName: name }),
  });
  if (!res.ok) {
    throw new Error("Failed to register terminal");
  }
  return res.json();
}

export async function regenerateTerminalSecret(merchantId: string, terminalId: string) {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/terminal/regenerate-secret`, {
    method: "POST",
    body: JSON.stringify({ merchantId, terminalId }),
  });
  if (!res.ok) {
    throw new Error("Failed to regenerate terminal secret");
  }
  return res.json();
}

export async function forceTerminalReboot(merchantId: string, terminalId: string) {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/terminal/force-reboot`, {
    method: "POST",
    body: JSON.stringify({ merchantId, terminalId }),
  });
  if (!res.ok) {
    throw new Error("Failed to send reboot command");
  }
  return res.json();
}

export async function deleteTerminal(merchantId: string, terminalId: string) {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/terminal/${encodeURIComponent(merchantId)}/${encodeURIComponent(terminalId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error("Failed to delete terminal");
  }
  return res.json();
}

export async function fetchSettings(): Promise<Settings> {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/settings`);
  if (!res.ok) {
    throw new Error("Failed to fetch settings");
  }
  return res.json();
}

export async function updateSettings(data: Record<string, unknown>) {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/settings`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error("Failed to update settings");
  }
  return res.json();
}

export async function fetchBatches(): Promise<Batch[]> {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/batches`);
  if (!res.ok) {
    throw new Error("Failed to fetch batches");
  }
  return res.json();
}

export async function downloadPain001PaymentFile(
  merchantId: string,
  payload: {
    settlementIds: string[];
    debtor: { name: string; iban?: string; accountId?: string; bic?: string; clearingMemberId?: string; country?: string; city?: string; addressLine?: string };
    creditor: { name: string; iban?: string; accountId?: string; bic?: string; clearingMemberId?: string; country?: string; city?: string; addressLine?: string };
    requestedExecutionDate?: string;
  }
): Promise<void> {
  const res = await fetchWithAuth(`${BASE_URL}/api/merchant/${encodeURIComponent(merchantId)}/payment-files/pain001`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Payment initiation file generation failed');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `${merchantId}_pain001.xml`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function fetchProducts(merchantId?: string): Promise<Product[]> {
  const url = `${BASE_URL}/merchant/v1/products${merchantId ? `?merchantId=${encodeURIComponent(merchantId)}` : ''}`;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error('Failed to fetch products');
  return res.json();
}

export async function createProduct(data: Partial<Product>) {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/products`, {
    method: 'POST',
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to create product');
  return res.json();
}

export async function readAcr122uCard() {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/payments/read-acr122u`, {
    method: 'POST',
    body: JSON.stringify({})
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'ACR122U reader unavailable');
  }

  return res.json();
}

export async function getAcr122uStatus() {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/payments/read-acr122u/status`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Unable to get NFC status');
  }
  return res.json();
}

export async function uploadBatch(batchData: Record<string, unknown>, secret: string = "") {
  const typedBatch = batchData as {
    protocolVersion?: string;
    merchantId?: string;
    terminalId?: string;
    batchId?: string;
    timestamp?: string | number;
    nonce?: string;
    transactions?: Array<Record<string, unknown>>;
  };

  // Generate signature
  const signature = await generateHmacSignature(
    typedBatch.protocolVersion || '',
    typedBatch.merchantId || '',
    typedBatch.terminalId || '',
    typedBatch.batchId || '',
    typeof typedBatch.timestamp === 'number' ? typedBatch.timestamp : Number(typedBatch.timestamp ?? 0),
    typedBatch.nonce || '',
    typedBatch.transactions?.length || 1,
    secret
  );

  const payload = { ...batchData, signature };

  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/pos/201.3/offline-batch`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    console.warn("Upload Batch failed", errorData);
    throw new Error(errorData.error || "Batch upload failed");
  }

  return res.json();
}

export async function chargePayment(amountMinor: number, currency: string, merchantId: string = "MRC-1001", cardData?: { pan: string; expiry: string; cvv?: string; customerId?: string }) {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/payments/charge`, {
    method: "POST",
    body: JSON.stringify({ amountMinor, currency, merchantId, ...cardData })
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || "Charge failed");
  }
  return res.json();
}

// NEW: Secure payment with HMAC signature for Protocol 201.3
export async function processSecurePayment(
  paymentData: {
    protocolVersion: string;
    merchantId: string;
    terminalId: string;
    batchId: string;
    timestamp: number;
    nonce: string;
    signature: string;
    transactions: Array<{
      localTxnId: string;
      stan: string;
      amountMinor: number;
      currency: string;
      pan: string;
      expiry: string;
      cvv?: string;
      txnType: string;
      entryMode: string;
      txnTimestamp: number;
    }>;
  }
) {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/api/payment2013/batch`, {
    method: "POST",
    headers: {
      "X-Merchant-Id": paymentData.merchantId,
      "X-Terminal-Id": paymentData.terminalId,
      "X-Signature": paymentData.signature,
    },
    body: JSON.stringify(paymentData),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || "Payment processing failed");
  }
  
  return res.json();
}

export async function changePassword(oldPassword: string, newPassword: string) {
  const res = await fetchWithAuth(`${BASE_URL}/auth/change-password`, {
    method: "POST",
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to change password");
  }

  const data = await res.json();
  if (data.status === false) {
    throw new Error(data.message || "Failed to change password");
  }
  return data;
}

export async function getProfile() {
  const res = await fetchWithAuth(`${BASE_URL}/auth/profile`);
  if (!res.ok) {
     const errorData = await res.json().catch(() => ({}));
     throw new Error(errorData.error || "Failed to load profile");
  }
  return res.json();
}

export async function updateProfile(profile: Record<string, unknown>) {
  const res = await fetchWithAuth(`${BASE_URL}/auth/profile`, {
    method: "PUT",
    body: JSON.stringify(profile),
  });
  if (!res.ok) {
     const errorData = await res.json().catch(() => ({}));
     throw new Error(errorData.error || "Failed to update profile");
  }
  return res.json();
}

export async function toggle2FA(enable: boolean) {
  const token = localStorage.getItem("token");
  const res = await fetch(`${BASE_URL}/auth/2fa/toggle`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({ enable }),
  });
  if (!res.ok) throw new Error("Failed to toggle 2FA");
  return res.json();
}

export async function getSessions() {
  const res = await fetchWithAuth(`${BASE_URL}/auth/sessions`);
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return res.json();
}

export async function revokeSession(sessionId: string) {
  const res = await fetchWithAuth(`${BASE_URL}/auth/sessions/${sessionId}`, {
    method: "DELETE"
  });
  if (!res.ok) throw new Error("Failed to revoke session");
  return res.json();
}

export async function regenerateApiKey() {
  const res = await fetchWithAuth(`${BASE_URL}/auth/api-key/regenerate`, {
    method: "POST"
  });
  if (!res.ok) throw new Error("Failed to regenerate API key");
  return res.json();
}


// Real Cashout System — see getCashouts/createCashout/processCashout at bottom of file
export interface Cashout {
  id: string;
  merchant_id: string;
  amount_minor: number;
  currency: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  gateway: string;
  gateway_payout_id?: string;
  error_message?: string;
  fee_minor: number;
  net_amount_minor: number;
  created_at: string;
  updated_at: string;
  transactions?: Array<Record<string, unknown>>;
}

// Protocol 201.3 - Live Redemption
export interface RedeemRequest {
  code: string;
  amount: number;
  merchantId?: string;
}

export interface RedeemResponse {
  success: boolean;
  message: string;
  reference?: string;
  time?: string;
}

export async function redeemPaymentCode(request: RedeemRequest): Promise<RedeemResponse> {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/api/payment2013/redeem`, {
    method: "POST",
    body: JSON.stringify(request)
  });
  
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || errorData.error || "Redemption failed");
  }
  
  return res.json();
}

// Get transaction by ID
export async function getTransactionById(id: string): Promise<Transaction | null> {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/transactions/${id}`);
  if (!res.ok) {
    return null;
  }
  return res.json();
}


// ==================== RECEIPTS API ====================

export async function fetchReceipts(): Promise<Receipt[]> {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/receipts`);
  if (!res.ok) {
    throw new Error("Failed to fetch receipts");
  }
  const data = await res.json();
  return data.receipts || [];
}

export async function generateReceipt(transactionId: string): Promise<Receipt> {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/receipts/generate/${transactionId}`, {
    method: "POST",
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to generate receipt");
  }
  const data = await res.json();
  return data.receipt;
}

export async function getReceipt(receiptId: string): Promise<Receipt | null> {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/receipts/${receiptId}`);
  if (!res.ok) {
    return null;
  }
  const data = await res.json();
  return data.receipt;
}

export async function printReceipt(receiptId: string): Promise<{
  receipt: Receipt; printable: string;
  plainTextCustomer?: string; plainTextMerchant?: string;
  thermalCustomer?: string; thermalMerchant?: string; thermalCombined?: string;
}> {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/receipts/${receiptId}/print`);
  if (!res.ok) {
    throw new Error("Failed to get printable receipt");
  }
  return res.json();
}

export type ThermalCopy = "combined" | "customer" | "merchant";

export async function generateThermalReceipt(
  transactionId: string,
  copy: ThermalCopy = "combined",
  format: "txt" | "json" = "json"
): Promise<any> {
  const url = `${BASE_URL}/merchant/v1/receipts/thermal/${transactionId}?copy=${copy}&format=${format}`;
  const res = await fetchWithAuth(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to generate thermal receipt");
  }
  if (format === "txt") return res.text();
  return res.json();
}

export function downloadThermalTxt(transactionId: string, copy: ThermalCopy = "combined") {
  const token = localStorage.getItem("token");
  const auth = token ? `?Authorization=Bearer%20${encodeURIComponent(token)}` : "";
  const base = `${BASE_URL}/merchant/v1/receipts/thermal/${transactionId}?copy=${copy}`;
  window.open(base + (auth ? "&" + auth.slice(1) : ""), "_blank", "noopener,noreferrer");
}


// ── STAN generator ─────────────────────────────────────────────────────────────
export function generateStan(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ════════════════════════════════════════════════════════════════════════════
// WALLET, VIRTUAL CARD, CRYPTO, BANK — all real API calls
// (interfaces defined at top of file — no duplicates here)
// ════════════════════════════════════════════════════════════════════════════

export async function getCustomers(): Promise<Customer[]> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/customers`);
  if (!res.ok) return [];
  return res.json();
}
export async function createCustomer(name: string, email?: string, phone?: string): Promise<Customer> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/customers`, { method: 'POST', body: JSON.stringify({ name, email, phone }) });
  if (!res.ok) throw new Error('Failed to create customer');
  return res.json();
}
export async function getWalletBalance(customerId: string): Promise<WalletBalance> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/balance/${customerId}`);
  if (!res.ok) return { balance: 0, currency: 'USD' };
  return res.json();
}
export async function getWalletTransactions(customerId: string): Promise<WalletTransaction[]> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/transactions/${customerId}`);
  if (!res.ok) return [];
  return res.json();
}
export async function topupWallet(customerId: string, amount: number, source?: string, reference?: string) {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/topup`, { method: 'POST', body: JSON.stringify({ customerId, amount, source, reference }) });
  if (!res.ok) throw new Error('Topup failed');
  return res.json();
}
export async function topupWalletWithCard(customerId: string, amount: number, cardNumber: string, panMasked?: string, expiry?: string, cvv?: string, emvData?: unknown) {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/topup/card`, {
    method: 'POST',
    body: JSON.stringify({ customerId, amount, cardNumber, panMasked, expiry, cvv, emvData })
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({} as ApiErrorPayload));
    throw new Error(errorData.error || 'Card topup failed');
  }
  return res.json();
}
export async function debitWallet(customerId: string, amount: number, source?: string, reference?: string) {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/debit`, { method: 'POST', body: JSON.stringify({ customerId, amount, source, reference }) });
  if (!res.ok) { const e = await res.json().catch(() => ({} as ApiErrorPayload)); throw new Error(e.error || 'Debit failed'); }
  return res.json();
}
export async function walletTransfer(senderCustomerId: string, receiverCustomerId: string, amount: number, note?: string): Promise<WalletTransfer> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/transfer`, { method: 'POST', body: JSON.stringify({ senderCustomerId, receiverCustomerId, amount, note }) });
  if (!res.ok) { const e = await res.json().catch(() => ({} as ApiErrorPayload)); throw new Error(e.error || 'Transfer failed'); }
  return res.json();
}
export async function getBankAccounts(customerId: string): Promise<BankAccount[]> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/bank-accounts/${customerId}`);
  if (!res.ok) return [];
  return res.json();
}
export async function addBankAccount(data: { customerId: string; bankName: string; accountHolder: string; accountNumber: string; routingNumber?: string; iban?: string; swiftCode?: string; currency?: string }): Promise<BankAccount> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/bank-accounts`, { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) throw new Error('Failed to add bank account');
  return res.json();
}
export async function bankPayout(customerId: string, bankAccountId: string, amount: number) {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/bank-payout`, { method: 'POST', body: JSON.stringify({ customerId, bankAccountId, amount }) });
  if (!res.ok) { const e = await res.json().catch(() => ({} as ApiErrorPayload)); throw new Error(e.error || 'Payout failed'); }
  return res.json();
}
export async function getBankPayouts(customerId: string): Promise<BankPayout[]> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/bank-payouts/${customerId}`);
  if (!res.ok) return [];
  return res.json();
}
export async function getCryptoWallets(customerId: string): Promise<CryptoWallet[]> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/crypto-wallets/${customerId}`);
  if (!res.ok) return [];
  return res.json();
}
export async function getCryptoPrice(coin: string): Promise<{ price: number; cryptoCoin: string }> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/crypto-price/${coin}`);
  if (!res.ok) return { price: 0, cryptoCoin: coin };
  return res.json();
}
export async function buyCryptoWithWallet(customerId: string, cryptoCoin: string, fiatAmount: number, network?: string, currency?: string) {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/buy-crypto`, { method: 'POST', body: JSON.stringify({ customerId, cryptoCoin, fiatAmount, ...(network ? { network } : {}), ...(currency ? { currency } : {}) }) });
  if (!res.ok) { const e = await res.json().catch(() => ({} as ApiErrorPayload)); throw new Error(e.error || 'Buy failed'); }
  return res.json();
}
export async function sellCrypto(customerId: string, cryptoCoin: string, cryptoAmount: number, network?: string) {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/sell-crypto`, { method: 'POST', body: JSON.stringify({ customerId, cryptoCoin, cryptoAmount, ...(network ? { network } : {}) }) });
  if (!res.ok) { const e = await res.json().catch(() => ({} as ApiErrorPayload)); throw new Error(e.error || 'Sell failed'); }
  return res.json();
}

export async function withdrawCrypto(customerId: string, cryptoCoin: string, amount: number, address: string, network: string) {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/crypto-withdraw`, {
    method: 'POST',
    body: JSON.stringify({ customerId, cryptoCoin, amount, address, network })
  });
  if (!res.ok) { const e = await res.json().catch(() => ({} as ApiErrorPayload)); throw new Error(e.error || 'Withdrawal failed'); }
  return res.json();
}

export async function merchantCryptoPayout(
  merchantId: string,
  payload: { 
    amount_usd: number; 
    asset: string; 
    address: string; 
    network: string; 
    sender_mode: 'hot' | 'treasury' | 'auto';
    authorizedPerson?: {
      name: string;
      role: string;
      email: string;
      phone?: string;
    };
    businessInfo?: {
      businessName: string;
      businessRegNumber?: string;
      businessAddress: string;
      businessPhone?: string;
      taxId?: string;
    };
    payoutReason?: string;
  }
) {
  const res = await fetchWithAuth(`${BASE_URL}/api/merchant/${encodeURIComponent(merchantId)}/payout/crypto`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Merchant crypto payout failed');
  return data;
}

export async function createVirtualAccount(
  merchantId: string,
  payload: {
    source: { fiatCurrency: string; paymentMethod: string };
    destination: { cryptoCurrency: string; walletAddress: string; network: string };
    transakAccessToken?: string;
    transakAuthRelianceEmail?: string;
  }
) {
  const res = await fetchWithAuth(`${BASE_URL}/api/bank-transfer/create-account`, {
    method: 'POST',
    headers: { 'x-merchant-id': merchantId },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Virtual account creation failed');
  return data as { success: boolean; transaction: BankTransferTransaction };
}

export async function transakVerifyWalletAddress(params: {
  cryptoCurrency: string;
  network: string;
  walletAddress: string;
}): Promise<{ ok: boolean; response: boolean }> {
  const query = new URLSearchParams({
    cryptoCurrency: params.cryptoCurrency,
    network: params.network,
    walletAddress: params.walletAddress,
  });
  const res = await fetchWithAuth(`${BASE_URL}/wallet/transak/wallet-address/verify?${query.toString()}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Wallet address verification failed');
  return data;
}

export async function transakGetWebhooks(params: {
  eventID?: string;
  orderID?: string;
  limit?: number;
  skip?: number;
  startDate?: string;
  endDate?: string;
  status?: 'success' | 'failed';
} = {}): Promise<{ ok: boolean; meta?: Record<string, unknown>; data: Array<Record<string, unknown>> }> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const res = await fetchWithAuth(`${BASE_URL}/wallet/transak/webhooks${suffix}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Transak webhook lookup failed');
  return data;
}

export async function listVirtualAccounts(merchantId: string) {
  const res = await fetchWithAuth(`${BASE_URL}/api/bank-transfer/list`, {
    headers: { 'x-merchant-id': merchantId },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Virtual account lookup failed');
  return data as { success: boolean; transactions: BankTransferTransaction[] };
}

export async function getVirtualAccount(merchantId: string, transactionId: string) {
  const res = await fetchWithAuth(`${BASE_URL}/api/bank-transfer/${encodeURIComponent(transactionId)}`, {
    headers: { 'x-merchant-id': merchantId },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Virtual account detail lookup failed');
  return data as { success: boolean; transaction: BankTransferTransaction };
}

export async function updateVirtualAccount(
  merchantId: string,
  transactionId: string,
  destination: { cryptoCurrency: string; walletAddress: string; network: string }
) {
  const res = await fetchWithAuth(`${BASE_URL}/api/bank-transfer/${encodeURIComponent(transactionId)}`, {
    method: 'PUT',
    headers: { 'x-merchant-id': merchantId },
    body: JSON.stringify({ destination }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Virtual account update failed');
  return data as { success: boolean; transaction: BankTransferTransaction };
}
export async function getCryptoTransactions(customerId: string): Promise<CryptoTransaction[]> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/crypto-transactions/${customerId}`);
  if (!res.ok) return [];
  return res.json();
}

export async function getMerchantBalance(merchantId: string): Promise<MerchantWallet> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/merchant-balance/${encodeURIComponent(merchantId)}`);
  if (!res.ok) return { id: '', merchant_id: merchantId, balance: 0, currency: 'USD' };
  const data = await res.json();
  return {
    id: data.id ?? '',
    merchant_id: data.merchant_id ?? data.merchantId ?? merchantId,
    balance: Number(data.balance ?? 0),
    currency: data.currency ?? 'USD',
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}

export async function getMerchantTransactions(merchantId: string): Promise<MerchantWalletTransaction[]> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/merchant-transactions/${encodeURIComponent(merchantId)}`);
  if (!res.ok) return [];
  const data = await res.json();
  const txns = (Array.isArray(data) ? data : []) as Array<Partial<MerchantWalletTransaction> & {
    wallet_id?: string;
    type?: MerchantWalletTransaction['type'];
    amount?: number;
    source?: string;
    reference?: string;
    description?: string;
    created_at?: string;
  }>;
  return txns.map((txn) => ({
    id: txn.id ?? '',
    wallet_id: txn.wallet_id ?? '',
    type: txn.type ?? 'credit',
    amount: Number(txn.amount ?? 0),
    source: txn.source ?? 'merchant_wallet',
    reference: txn.reference,
    description: txn.description,
    created_at: txn.created_at ?? '',
  }));
}

export async function exportTransactionsToCSV(transactions: Transaction[]) {
  // Wise-compatible batch payment CSV
  const headers = [
    'name', 'recipientEmail', 'paymentReference', 'referenceNumber', 'receiverType',
    'amount', 'sourceCurrency', 'targetCurrency',
    'batchId', 'stan', 'authMode', 'entryMode', 'status', 'date'
  ];
  const escapeCsv = (v: string | number | undefined) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const rows = transactions.map(t => [
    t.merchantId || 'Merchant',
    '',
    `REF-${t.id}`,
    t.id,
    'BUSINESS',
    ((t.amountMinor || 0) / 100).toFixed(2),
    t.currency || 'USD',
    t.currency || 'USD',
    t.batchId || '',
    t.stan || '',
    t.authMode || '',
    t.entryMode || '',
    t.status,
    new Date(t.txnTimestamp).toISOString(),
  ]);
  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(escapeCsv).join(','))
  ].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `wise_transactions_${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function buyCryptoWithMerchant(
  merchantId: string,
  cryptoCoin: string,
  fiatAmount: number,
  network?: string
) {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/merchant/buy-crypto`, {
    method: 'POST',
    body: JSON.stringify({
      merchantId, cryptoCoin, fiatAmount,
      ...(network ? { network } : {}),
    })
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({} as ApiErrorPayload));
    const err = new Error(errorData.error || 'Merchant crypto purchase failed');
    (err as any).hint = (errorData as any)?.hint;
    throw err;
  }
  return res.json();
}

export async function merchantToCustomerTransfer(
  merchantId: string,
  customerId: string,
  amount: number,
  note?: string,
  currency = 'USD'
): Promise<{ success: boolean; transferId: string; reference: string; amount: number; currency: string; customerName: string }> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/merchant/transfer-to-customer`, {
    method: 'POST',
    body: JSON.stringify({ merchantId, customerId, amount, note, currency }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({} as ApiErrorPayload));
    throw new Error(err.error || 'Transfer failed');
  }
  return res.json();
}

// ── Transak Fiat On/Off-Ramp ──────────────────────────────────────────────────

export interface TransakConfigResponse {
  configured: boolean;
  mode: 'staging' | 'production';
  apiKey: string;
  widgetUrl: string;
  referrerDomain: string;
  networks: string[];
}

export interface TransakWidgetSessionResponse {
  ok: boolean;
  sessionId: string;
  widgetUrl: string;
  expiresAt: string;
  note?: string;
}

export interface TransakOrderStatusResponse {
  ok: boolean;
  order: {
    id: string;
    status: string;
    fiatCurrency: string;
    fiatAmount: number;
    cryptoCurrency: string;
    cryptoAmount: number;
    network?: string;
    walletAddress?: string;
    transactionHash?: string;
    createdAt: string;
    updatedAt: string;
  };
}

export interface TransakQuoteResponse {
  quoteId: string;
  conversionPrice: number;
  marketConversionPrice: number;
  fiatCurrency: string;
  cryptoCurrency: string;
  paymentMethod: string;
  fiatAmount: number;
  cryptoAmount: number;
  network: string;
  totalFee: number;
  feeDecimal: number;
}

export interface TransakCountryState {
  code: string;
  name: string;
  isAllowed: boolean;
}

export interface TransakCountryPartner {
  name: string;
  currencyCode: string;
  isCardPayment: boolean;
}

export type TransakSupportedDocument =
  | 'passport'
  | 'driving_licence'
  | 'national_identity_card'
  | (string & NonNullable<unknown>);

export interface TransakCountry {
  alpha2: string;
  alpha3: string;
  isAllowed: boolean;
  isLightKycAllowed?: boolean;
  name: string;
  currencyCode: string;
  supportedDocuments: TransakSupportedDocument[];
  partners?: TransakCountryPartner[];
  states?: TransakCountryState[];
}

export interface TransakCountriesResponse {
  ok: boolean;
  mode?: 'staging' | 'production';
  response: TransakCountry[];
  error?: string;
}

export interface TransakWidgetSessionParams {
  customerId?: string;
  walletCode?: string;
  partnerCustomerId?: string;
  partnerOrderId?: string;
  partnerMetaData?: Record<string, any> | string;
  defaultCryptoCurrency?: string;
  defaultNetwork?: string;
  defaultFiatAmount?: number;
  defaultFiatCurrency?: string;
  fiatCurrency?: string;
  cryptoCurrencyList?: string;
  networks?: string;
  walletAddress?: string;
  email?: string;
  redirectURL?: string;
  productsAvailed?: 'BUY' | 'SELL' | 'BUY,SELL';
  referralCode?: string;
  isAutoFillUserData?: boolean;
  excludeFiatCurrencies?: string;
  excludeNetworks?: string;
}

export async function transakGetConfig(): Promise<TransakConfigResponse> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/transak/config`);
  if (!res.ok) return { configured: false, mode: 'staging', apiKey: '', widgetUrl: '', referrerDomain: '', networks: [] };
  return res.json();
}

export async function transakCreateWidgetSession(
  params: TransakWidgetSessionParams
): Promise<TransakWidgetSessionResponse> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/transak/widget-session`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({} as ApiErrorPayload));
    throw new Error(e.error || 'Transak widget session creation failed');
  }
  return res.json();
}

export async function transakSendUserOtp(email: string): Promise<{ ok: boolean; email: string; stateToken: string; expiresIn: number }> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/transak/user/send-otp`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Transak OTP request failed');
  return data;
}

export async function transakVerifyUserOtp(email: string, otp: string, stateToken: string): Promise<{ ok: boolean; accessToken: string; expiresAt?: number }> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/transak/user/verify-otp`, {
    method: 'POST',
    body: JSON.stringify({ email, otp, stateToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Transak OTP verification failed');
  return data;
}

export async function transakGetUserLimits(params: {
  accessToken: string;
  fiatCurrency: string;
  paymentCategory: string;
  kycType?: 'SIMPLE' | 'STANDARD';
}): Promise<{ ok: boolean; limits: { limits: Record<string, number>; spent: Record<string, number>; remaining: Record<string, number>; exceeded: Record<string, boolean>; shortage: Record<string, number> } }> {
  const query = new URLSearchParams({
    fiatCurrency: params.fiatCurrency,
    paymentCategory: params.paymentCategory,
    kycType: params.kycType || 'STANDARD',
  });
  const res = await fetchWithAuth(`${BASE_URL}/wallet/transak/user/limits?${query.toString()}`, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Transak user limits lookup failed');
  return data;
}

export async function transakGetUserDetails(accessToken: string): Promise<{ ok: boolean; user: { email: string; firstName?: string; lastName?: string; status?: string; kyc?: { status?: string; type?: string } } }> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/transak/user/details`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Transak user details lookup failed');
  return data;
}

export async function transakRefreshUserAccessToken(accessToken: string): Promise<{ ok: boolean; accessToken: string }> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/transak/user/refresh`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Transak user token refresh failed');
  return data;
}

export async function transakLogoutUser(accessToken: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/transak/user/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Transak logout failed');
  return data;
}

export async function transakOnboardUser(email: string): Promise<{ ok: boolean; user: { email: string; status?: string; kyc?: { status?: string; type?: string } } }> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/transak/user/onboard`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Transak Auth Reliance onboarding failed');
  return data;
}

export async function transakGetOrderStatus(orderId: string): Promise<TransakOrderStatusResponse> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/transak/orders/${encodeURIComponent(orderId)}`);
  if (!res.ok) {
    const e = await res.json().catch(() => ({} as ApiErrorPayload));
    throw new Error(e.error || 'Transak order status lookup failed');
  }
  return res.json();
}

export async function transakGetCountries(): Promise<TransakCountriesResponse> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/transak/countries`);
  if (!res.ok) {
    const e = await res.json().catch(() => ({} as ApiErrorPayload));
    return { ok: false, response: [], error: e.error || 'Transak countries lookup failed' };
  }
  return res.json();
}

export async function transakGetQuote(params: {
  cryptoCurrency: string;
  fiatCurrency: string;
  network: string;
  fiatAmount: number;
  paymentMethod?: string;
  quoteCountryCode?: string;
}): Promise<TransakQuoteResponse> {
  const query = new URLSearchParams({
    cryptoCurrency: params.cryptoCurrency,
    fiatCurrency: params.fiatCurrency,
    isBuyOrSell: 'BUY',
    network: params.network,
    fiatAmount: String(params.fiatAmount),
    paymentMethod: params.paymentMethod || 'bank_transfer',
  });
  if (params.quoteCountryCode) query.set('quoteCountryCode', params.quoteCountryCode);
  const res = await fetchWithAuth(`${BASE_URL}/wallet/transak/quote?${query.toString()}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Transak quote request failed');
  if (!data.response?.quoteId) throw new Error('Transak returned no quote ID');
  return data.response as TransakQuoteResponse;
}

// ── Cashouts (kept for SettlementsPage compatibility) ──────────────────────────
export async function getCashouts() {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/cashouts`);
  if (!res.ok) return [];
  return res.json();
}
export async function createCashout(data: Record<string, unknown>) {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/cashouts`, { method: 'POST', body: JSON.stringify(data) });
  if (!res.ok) throw new Error('Failed to create cashout');
  return res.json();
}
export async function processCashout(cashoutId: string) {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/cashouts/${cashoutId}/process`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to process cashout');
  return res.json();
}
export async function cashoutBraintree(items: Array<Record<string, unknown>>) {
  return createCashout({ items, gateway: 'braintree' });
}

// Compatibility wrapper for MyFatoorah cashouts (some pages import this name)
export async function cashoutMyFatoorah(items: Array<Record<string, unknown>>) {
  return createCashout({ items, gateway: 'myfatoorah' });
}

// ── Offline wallet payment stubs (localStorage-based, used by POSPage) ────────
// OfflineWalletPayment interface is defined at top of file
const OWP_KEY = "pos_offline_wallet_payments";
export function saveOfflineWalletPayment(p: Omit<OfflineWalletPayment,"id"|"synced">): OfflineWalletPayment {
  const arr: OfflineWalletPayment[] = JSON.parse(localStorage.getItem(OWP_KEY)||"[]");
  const item: OfflineWalletPayment = { ...p, id: `owp_${Date.now()}`, synced: false };
  arr.push(item);
  localStorage.setItem(OWP_KEY, JSON.stringify(arr));
  return item;
}
export function getOfflineWalletPayments(): OfflineWalletPayment[] {
  return JSON.parse(localStorage.getItem(OWP_KEY)||"[]");
}
export async function syncOfflineWalletPayments(): Promise<{ synced: number; failed: number }> {
  const pending = getOfflineWalletPayments().filter(p => !p.synced);
  let synced = 0, failed = 0;
  for (const p of pending) {
    try {
      await debitWallet(p.customerId, p.amount, "pos_offline_sync", `STAN:${p.stan}`);
      const arr: OfflineWalletPayment[] = JSON.parse(localStorage.getItem(OWP_KEY)||"[]");
      const idx = arr.findIndex(x => x.id === p.id);
      if (idx >= 0) { arr[idx].synced = true; localStorage.setItem(OWP_KEY, JSON.stringify(arr)); }
      synced++;
    } catch { failed++; }
  }
  return { synced, failed };
}

// ── Offline PIN sale upload queue for POS EMV offline approvals ─────────────
export interface OfflinePinSalePayload {
  merchantId: string;
  terminalId?: string;
  amountMinor: number;
  currency: string;
  panMasked?: string;
  txnType?: string;
  authMode?: string;
  entryMode?: string;
  cardBrand?: string;
  readerSource?: string;
  cvmResult?: string;
  pinVerified?: boolean;
  rrn?: string;
  stan?: string;
  authCode?: string;
  emvData?: unknown;
  tlvRaw?: string;
  ledgerEntryId?: string | null;
  localTxnId?: string;
}

export interface OfflinePinSale extends OfflinePinSalePayload {
  id: string;
  synced: boolean;
  error?: string;
}

const OPP_KEY = "pos_offline_pin_sales";

export async function uploadOfflinePinSale(payload: OfflinePinSalePayload) {
  const res = await fetch(`${BASE_URL}/merchant/v1/payments/offline-pin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({} as ApiErrorPayload));
    throw new Error(body.error || `Offline PIN upload failed (${res.status})`);
  }

  return res.json();
}

export function saveOfflinePinSale(p: Omit<OfflinePinSale, "id" | "synced">): OfflinePinSale {
  const arr: OfflinePinSale[] = JSON.parse(localStorage.getItem(OPP_KEY) || "[]");
  const item: OfflinePinSale = { id: `opp_${Date.now()}`, synced: false, ...p };
  arr.push(item);
  localStorage.setItem(OPP_KEY, JSON.stringify(arr));
  return item;
}

export function getOfflinePinSales(): OfflinePinSale[] {
  return JSON.parse(localStorage.getItem(OPP_KEY) || "[]");
}

export async function syncOfflinePinSales(): Promise<{ synced: number; failed: number }> {
  const pending = getOfflinePinSales().filter(p => !p.synced);
  let synced = 0;
  let failed = 0;
  const remaining: OfflinePinSale[] = [];

  for (const item of pending) {
    try {
      await uploadOfflinePinSale(item);
      synced++;
    } catch (error: any) {
      failed++;
      remaining.push({ ...item, error: error?.message || 'Upload failed' });
    }
  }

  if (remaining.length !== pending.length) {
    localStorage.setItem(OPP_KEY, JSON.stringify(remaining));
  }

  return { synced, failed };
}

