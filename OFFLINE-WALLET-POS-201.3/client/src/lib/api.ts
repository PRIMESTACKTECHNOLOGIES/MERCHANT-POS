import { generateHmacSignature } from './crypto';
import { resolveApiBaseUrl } from './backendUrl';

const BASE_URL = resolveApiBaseUrl({
  envValue: (import.meta.env.VITE_API_URL || '').includes(':3001') ? '' : import.meta.env.VITE_API_URL,
  currentOrigin: window.location.origin,
  localFallback: 'http://localhost:7000',
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
export interface VirtualCard { id: string; masked_number: string; expiry_month: number; expiry_year: number; cardholder_name: string; card_type: string; status: string; balance: number; currency: string; daily_limit: number; daily_spent: number; created_at: string; }
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
  return res.json();
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

async function cashoutBatches(batches: Array<Record<string, unknown>>) {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/api/payment2013/cashout`, {
    method: "POST",
    body: JSON.stringify({ batches }),
  });

  const result = await res.json();
  return {
    ...result,
    success: result.success ?? result.failed === 0,
    message: result.message ?? `Processed ${result.synced ?? 0} batches`,
  };
}

export async function cashoutBraintree(batches: Array<Record<string, unknown>>) {
  return cashoutBatches(batches);
}

export async function cashoutMyFatoorah(batches: Array<Record<string, unknown>>) {
  return cashoutBatches(batches);
}

export async function chargePayment(amountMinor: number, currency: string, merchantId: string = "MRC-1001", cardData?: { pan: string; expiry: string }) {
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

// ── Primestack offline queue helpers (used by EMV bridge) ─────────────────────
export interface PrimestackQueueRequest {
  amount: number;
  currency: string;
  cardLast4: string;
  cardBrand: string;
  offlineRef: string;
  capturedAt: string;
  terminalId: string;
}

export async function primestackQueueOffline(data: PrimestackQueueRequest) {
  return fetchWithAuth(`${BASE_URL}/primestack/offline/queue`, {
    method: "POST",
    body: JSON.stringify(data)
  });
}

export async function primestackSyncOffline(): Promise<{ approved: number; declined: number }> {
  const res = await fetchWithAuth(`${BASE_URL}/primestack/offline/sync`, { method: "POST" });
  if (!res.ok) return { approved: 0, declined: 0 };
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

export async function printReceipt(receiptId: string): Promise<{ receipt: Receipt; printable: string }> {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/receipts/${receiptId}/print`);
  if (!res.ok) {
    throw new Error("Failed to get printable receipt");
  }
  return res.json();
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
export async function getVirtualCards(customerId: string): Promise<VirtualCard[]> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/virtual-cards/${customerId}`);
  if (!res.ok) return [];
  return res.json();
}
export async function issueVirtualCard(customerId: string, cardholderName: string, currency = 'USD'): Promise<VirtualCard & { cardNumber: string; cvv: string }> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/virtual-cards/issue`, { method: 'POST', body: JSON.stringify({ customerId, cardholderName, currency }) });
  if (!res.ok) throw new Error('Failed to issue card');
  return res.json();
}
export async function topupVirtualCard(customerId: string, cardId: string, amount: number) {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/virtual-cards/topup`, { method: 'POST', body: JSON.stringify({ customerId, cardId, amount }) });
  if (!res.ok) { const e = await res.json().catch(() => ({} as ApiErrorPayload)); throw new Error(e.error || 'Card topup failed'); }
  return res.json();
}
export async function freezeCard(customerId: string, cardId: string) {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/virtual-cards/freeze`, { method: 'POST', body: JSON.stringify({ customerId, cardId }) });
  if (!res.ok) throw new Error('Failed to freeze card');
  return res.json();
}
export async function unfreezeCard(customerId: string, cardId: string) {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/virtual-cards/unfreeze`, { method: 'POST', body: JSON.stringify({ customerId, cardId }) });
  if (!res.ok) throw new Error('Failed to unfreeze card');
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
export async function buyCryptoWithWallet(customerId: string, cryptoCoin: string, fiatAmount: number, network?: string) {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/buy-crypto`, { method: 'POST', body: JSON.stringify({ customerId, cryptoCoin, fiatAmount, ...(network ? { network } : {}) }) });
  if (!res.ok) { const e = await res.json().catch(() => ({} as ApiErrorPayload)); throw new Error(e.error || 'Buy failed'); }
  return res.json();
}
export async function sellCrypto(customerId: string, cryptoCoin: string, cryptoAmount: number, network?: string) {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/sell-crypto`, { method: 'POST', body: JSON.stringify({ customerId, cryptoCoin, cryptoAmount, ...(network ? { network } : {}) }) });
  if (!res.ok) { const e = await res.json().catch(() => ({} as ApiErrorPayload)); throw new Error(e.error || 'Sell failed'); }
  return res.json();
}
export async function getCryptoTransactions(customerId: string): Promise<CryptoTransaction[]> {
  const res = await fetchWithAuth(`${BASE_URL}/wallet/crypto-transactions/${customerId}`);
  if (!res.ok) return [];
  return res.json();
}

export async function getMerchantBalance(merchantId: string): Promise<MerchantWallet> {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/wallet/${encodeURIComponent(merchantId)}`);
  if (!res.ok) return { id: '', merchant_id: merchantId, balance: 0, currency: 'USD' };
  return res.json();
}

export async function getMerchantTransactions(merchantId: string): Promise<MerchantWalletTransaction[]> {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/wallet/${encodeURIComponent(merchantId)}/transactions`);
  if (!res.ok) return [];
  return res.json();
}

export async function exportTransactionsToCSV(transactions: Transaction[]) {
  const rows = transactions.map((txn) => ({
    id: txn.id,
    merchantId: txn.merchantId,
    terminalId: txn.terminalId,
    amountMinor: txn.amountMinor,
    currency: txn.currency,
    status: txn.status,
    createdAt: txn.txnTimestamp,
  }));

  const header = ['id', 'merchantId', 'terminalId', 'amountMinor', 'currency', 'status', 'createdAt'];
  const csv = [header.join(','), ...rows.map((row) => header.map((col) => JSON.stringify(String(row[col as keyof typeof row] ?? ''))).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'transactions.csv';
  link.click();
  URL.revokeObjectURL(url);
}

export async function buyCryptoWithMerchant(merchantId: string, cryptoCoin: string, fiatAmount: number, network?: string) {
  const res = await fetchWithAuth(`${BASE_URL}/merchant/v1/buy-crypto`, {
    method: 'POST',
    body: JSON.stringify({ merchantId, cryptoCoin, fiatAmount, ...(network ? { network } : {}) })
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({} as ApiErrorPayload));
    throw new Error(errorData.error || 'Merchant crypto purchase failed');
  }
  return res.json();
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

