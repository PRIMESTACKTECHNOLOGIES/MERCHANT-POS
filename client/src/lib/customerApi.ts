/**
 * customerApi.ts
 * ──────────────
 * API helper for the CUSTOMER portal (/portal/*).
 *
 * This is intentionally SEPARATE from lib/api.ts:
 *   - it stores its session under its own key (`customer_token`), so a customer
 *     login never clobbers / inherits the merchant `token`;
 *   - on 401/403 it redirects to `/portal/login` (NOT the merchant `/login`).
 *
 * The backend derives the customer identity from this token only, so every
 * call below is automatically scoped to the logged-in customer.
 */

import { resolveApiBaseUrl } from './backendUrl';

const BASE_URL = resolveApiBaseUrl({
  envValue: import.meta.env.VITE_API_URL,
  currentOrigin: window.location.origin,
});

export const CUSTOMER_TOKEN_KEY = 'customer_token';
export const CUSTOMER_PROFILE_KEY = 'customer_profile';

export interface CustomerSession {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  wallet_code?: string;
}

export interface PortalWallet {
  id: string;
  customer_id: string;
  balance: number;
  currency: string;
  wallet_code?: string;
  /** Inline SVG QR of the wallet code, rendered by the backend. */
  qr_data_url?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PortalRecipient {
  name?: string;
  wallet_code: string;
  last_sent?: string;
}

export interface PortalCryptoWallet {
  id?: string;
  crypto_coin: string;
  crypto_address?: string | null;
  balance: number;
  status?: string;
}

export interface PortalTransaction {
  id: string;
  wallet_id: string;
  type: 'credit' | 'debit' | string;
  amount: number;
  currency?: string;
  source?: string;
  reference?: string;
  description?: string;
  status?: string;
  created_at: string;
}

export interface PortalProfile {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  country?: string;
  postal_code?: string;
  occupation?: string;
  nationality?: string;
  date_of_birth?: string;
  kyc_status?: string;
  risk_level?: string;
  pin_set?: boolean;
  /** The PIN the customer logged in with — shown so they can share/keep it. */
  pin_code?: string | null;
  wallet_code?: string;
}

export interface PortalOverview {
  profile: {
    id: string;
    name?: string;
    email?: string;
    phone?: string;
    kyc_status?: string;
    risk_level?: string;
    pin_set?: boolean;
  };
  wallets: PortalWallet[];
  cryptoWallets: PortalCryptoWallet[];
  recentTransactions: PortalTransaction[];
}

// ─── Session storage ───────────────────────────────────────────────────────────
export function getCustomerToken(): string | null {
  try {
    return localStorage.getItem(CUSTOMER_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getCustomerProfile(): CustomerSession | null {
  try {
    const raw = localStorage.getItem(CUSTOMER_PROFILE_KEY);
    return raw ? (JSON.parse(raw) as CustomerSession) : null;
  } catch {
    return null;
  }
}

export function isCustomerLoggedIn(): boolean {
  return !!getCustomerToken();
}

export function clearCustomerSession(): void {
  try {
    localStorage.removeItem(CUSTOMER_TOKEN_KEY);
    localStorage.removeItem(CUSTOMER_PROFILE_KEY);
  } catch {
    /* ignore */
  }
}

function storeSession(token: string, customer: CustomerSession): void {
  try {
    localStorage.setItem(CUSTOMER_TOKEN_KEY, token);
    localStorage.setItem(CUSTOMER_PROFILE_KEY, JSON.stringify(customer));
  } catch {
    /* ignore */
  }
}

// ─── Core request wrapper ──────────────────────────────────────────────────────
async function cReq<T>(path: string, options: RequestInit = {}, skipAuthRedirect = false): Promise<T> {
  const token = getCustomerToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    if ((res.status === 401 || res.status === 403) && !skipAuthRedirect) {
      clearCustomerSession();
      if (window.location.pathname !== '/portal/login') {
        window.location.href = '/portal/login';
      }
    }
    const message = (data && data.error) || `Request failed (${res.status})`;
    throw new Error(message);
  }

  return data as T;
}

// ─── Auth ──────────────────────────────────────────────────────────────────────
export async function customerLogin(walletCode: string, pin: string): Promise<CustomerSession> {
  const result = await cReq<{ token: string; customer: CustomerSession }>(
    '/api/customer-auth/login',
    { method: 'POST', body: JSON.stringify({ walletCode, pin }) },
    true
  );
  storeSession(result.token, result.customer);
  return result.customer;
}

export function customerLogout(): void {
  clearCustomerSession();
}

export async function getCustomerMe(): Promise<PortalProfile> {
  return cReq<PortalProfile>('/api/customer-auth/me');
}

export async function updatePortalProfile(profile: Partial<PortalProfile>): Promise<{ status: boolean; message: string }> {
  return cReq('/api/customer-auth/profile', { method: 'PUT', body: JSON.stringify(profile) });
}

export async function changePortalPin(currentPin: string, newPin: string): Promise<{ status: boolean; message: string }> {
  return cReq('/api/customer-auth/change-pin', { method: 'POST', body: JSON.stringify({ currentPin, newPin }) });
}

// ─── Portal data ───────────────────────────────────────────────────────────────
export async function getPortalOverview(): Promise<PortalOverview> {
  return cReq<PortalOverview>('/api/customer-portal/overview');
}

export async function getPortalProfile(): Promise<PortalProfile> {
  return cReq<PortalProfile>('/api/customer-portal/profile');
}

export async function portalWallet(): Promise<{ wallets: PortalWallet[]; cryptoWallets: PortalCryptoWallet[] }> {
  return cReq('/api/customer-portal/wallet');
}

export async function portalTransactions(currency?: string): Promise<PortalTransaction[]> {
  const qs = currency ? `?currency=${encodeURIComponent(currency)}` : '';
  return cReq<PortalTransaction[]>(`/api/customer-portal/transactions${qs}`);
}

export async function portalReceive(): Promise<{
  wallets: PortalWallet[];
  cryptoWallets: PortalCryptoWallet[];
  portal_pin?: string | null;
}> {
  return cReq('/api/customer-portal/receive');
}

export async function portalRecipients(): Promise<PortalRecipient[]> {
  return cReq('/api/customer-portal/recipients');
}

export async function portalSend(payload: {
  receiverWalletCode: string;
  amount: number;
  note?: string;
  currency?: string;
}): Promise<{ success: boolean; transferId: string; reference: string; amount: number; currency: string }> {
  return cReq('/api/customer-portal/send', { method: 'POST', body: JSON.stringify(payload) });
}

/**
 * C2M — pay a merchant by pulling real funds through the provider.
 *
 * The provider endpoint URL is configured ON THE SERVER (`CUSTOMER_WALLET_PROVIDER_URL`),
 * never sent by the customer, so a customer cannot point the debit at an arbitrary host.
 * The customer supplies only their own provider API key + secret (HMAC-SHA512 pull).
 * The customer id is derived from the session token on the backend.
 */
export async function portalCallProvider(payload: {
  merchantId: string;
  amountMinor: number;
  currency: string;
  apiKey: string;
  secretKey: string;
  requestReference: string;
  reason?: string;
}): Promise<{
  success: boolean;
  reference: string;
  providerReference: string;
  amount: number;
  currency: string;
  merchantId: string;
  description?: string;
}> {
  return cReq('/api/customer-portal/c2m/call-provider', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface PortalCardChargeResult {
  success: boolean;
  status: 'APPROVED' | 'DECLINED' | 'PENDING' | string;
  channel?: string;
  paymentIntentId?: string;
  authCode?: string;
  amountMinor?: number;
  currency?: string;
  reason?: string;
  error?: string;
}

/**
 * Pay a merchant by card. Runs the POS charge on the backend so the EMV value is
 * actually collected instead of only being queued in the browser.
 */
export async function portalPayWithCard(payload: {
  merchantId: string;
  amountMinor: number;
  currency: string;
  pan: string;
  expiry: string;
  cvv: string;
  emv?: Record<string, unknown>;
  stan?: string;
  terminalId?: string;
  entryMode?: string;
}): Promise<PortalCardChargeResult> {
  return cReq<PortalCardChargeResult>('/api/customer-portal/pay/card', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
