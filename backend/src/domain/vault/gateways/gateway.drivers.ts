/**
 * Payment-Gateway Drivers — load a vault card directly from a gateway
 * ─────────────────────────────────────────────────────────────────────────────
 * A loader pays on the gateway's own hosted checkout page. When the gateway
 * says the payment succeeded, the amount is credited to the vault card.
 *
 * Safety model (important):
 *   The webhook is only a TRIGGER. It never decides anything. Whatever a
 *   webhook claims, the credit decision is always taken from `verify()`, which
 *   asks the gateway's REST API directly whether that payment really succeeded
 *   and for how much. A forged webhook therefore cannot create funds — at
 *   worst it causes one extra (failed) verify call.
 *
 *   `verify()` must return the provider's own amount and currency, and
 *   gateway.service.ts refuses to credit unless they match the recorded charge
 *   exactly. Combined with the currency-match-only rule, no FX is ever guessed.
 *
 * Adding a gateway: add a GatewayDef and a driver. Both are required — a
 * gateway with no driver is reported as unavailable rather than half-working.
 */

import axios from 'axios';
import crypto from 'crypto';

// ── Money helpers ─────────────────────────────────────────────────────────────
/** Major units → minor units (cents/pesewas/kobo). */
const toMinor = (amount: number) => Math.round(amount * 100);
/** Minor units → major units. */
const toMajor = (minor: number | string) => Number(minor) / 100;
/** SHA-256 HMAC in hex, with a `sha512`/`hex` variant for Paystack. */
const hmac = (algo: string, secret: string, payload: crypto.BinaryLike) =>
  crypto.createHmac(algo, secret).update(payload).digest('hex');
/** Constant-time string compare that never throws on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
/** PayPal and Stripe want an amount formatted to the currency's own scale. */
const AMPED_ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF']);
function formatForPaypal(amount: number, currency: string): string {
  return AMPED_ZERO_DECIMAL.has(currency) ? String(Math.round(amount)) : amount.toFixed(2);
}

// ── Gateway catalogue ─────────────────────────────────────────────────────────
export interface GatewayDef {
  id: string;
  title: string;
  subtitle: string;
  /** Currencies the gateway can actually collect. A card in any other currency is refused. */
  currencies: string[];
  /** Every one of these env vars must be set before the rail is offered at all. */
  requiredEnv: string[];
  /** false → the API contract is not wired up; the rail is shown as unavailable. */
  implemented: boolean;
  /** Why it is unavailable, shown verbatim in the UI. */
  note?: string;
}

export const GATEWAYS: GatewayDef[] = [
  {
    id: 'paystack', title: 'Paystack', subtitle: 'Cards, bank transfer, USSD — Nigeria, Ghana, Kenya, South Africa',
    currencies: ['NGN', 'GHS', 'ZAR', 'KES', 'USD'], requiredEnv: ['PAYSTACK_SECRET_KEY'], implemented: true,
  },
  {
    id: 'flutterwave', title: 'Flutterwave', subtitle: 'Cards, mobile money, bank transfer — Africa-wide',
    currencies: ['NGN', 'GHS', 'ZAR', 'KES', 'USD', 'EUR', 'GBP'],
    requiredEnv: ['FLUTTERWAVE_SECRET_KEY'], implemented: true,
  },
  {
    id: 'razorpay', title: 'Razorpay', subtitle: 'UPI, cards, netbanking, wallets — India',
    currencies: ['INR'], requiredEnv: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'], implemented: true,
  },
  {
    id: 'xendit', title: 'Xendit', subtitle: 'Cards, virtual accounts, e-wallets — Indonesia, Philippines',
    currencies: ['IDR', 'PHP', 'USD'], requiredEnv: ['XENDIT_SECRET_KEY'], implemented: true,
  },
  {
    id: 'stripe', title: 'Stripe', subtitle: 'Cards, wallets — global',
    currencies: ['USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD', 'CHF', 'JPY'],
    requiredEnv: ['STRIPE_SECRET_KEY'], implemented: true,
  },
  {
    id: 'paypal', title: 'PayPal', subtitle: 'PayPal balance, cards — global',
    currencies: ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD'],
    requiredEnv: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'], implemented: true,
  },
  {
    id: 'shift4', title: 'Shift4', subtitle: 'Cards — global',
    currencies: ['USD', 'EUR', 'GBP'], requiredEnv: ['SHIFT4_SECRET_KEY'], implemented: true,
  },
  {
    id: 'paysafe', title: 'Paysafe', subtitle: 'Cards, wallets — global',
    currencies: ['USD', 'EUR', 'GBP'], requiredEnv: ['PAYSAFE_API_KEY', 'PAYSAFE_ACCOUNT_ID'], implemented: false,
    note: 'Paysafe has several distinct products (Payment Hub vs Paysafe Checkout) with different hosted-page contracts. Send the API docs for the account you hold and I will wire the correct one.',
  },
  {
    id: 'zinapay', title: 'ZinaPay', subtitle: 'Cards, wallets',
    currencies: ['USD'], requiredEnv: ['ZINAPAY_API_KEY'], implemented: false,
    note: 'No public API documentation for ZinaPay. Send the merchant API docs (base URL, checkout endpoint, verify endpoint, webhook signature scheme).',
  },
  {
    id: 'absa', title: 'ABSA', subtitle: 'Cards — South Africa',
    currencies: ['ZAR', 'USD'], requiredEnv: ['ABSA_API_KEY', 'ABSA_MERCHANT_ID'], implemented: false,
    note: 'ABSA online payments are issued per-merchant with a bespoke contract. Send your merchant integration pack (endpoint, credential layout, signature scheme).',
  },
];

export function getGateway(id: string): GatewayDef | undefined {
  return GATEWAYS.find((g) => g.id === id);
}

const env = (k: string) => (process.env[k] || '').trim();

/** True when every required credential is present and a driver exists. */
export function gatewayIsConfigured(g: GatewayDef): boolean {
  return g.implemented && g.requiredEnv.every((k) => env(k));
}

/** Shown in the UI when a rail cannot be used. */
export function gatewayUnavailableReason(g: GatewayDef): string | undefined {
  if (!g.implemented) return g.note || 'Not implemented yet.';
  const missing = g.requiredEnv.filter((k) => !env(k));
  return missing.length ? `Requires ${missing.join(' and ')} to be set on this server.` : undefined;
}

/** Public base URLs; sandbox overrides come from env so the same build works for both. */
const PAYPAL_BASE = () => env('PAYPAL_API_BASE') || 'https://api-m.paypal.com';

// ── Driver contract ───────────────────────────────────────────────────────────
export interface CheckoutRequest {
  /** Charge amount in MAJOR units, e.g. 100.50 */
  amount: number;
  currency: string;
  /** Our own unique reference for this charge (also sent to the gateway). */
  reference: string;
  /** Where the payer is sent after paying. */
  returnUrl: string;
  email: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  /** The gateway's own identifier — the only thing `verify()` is allowed to trust. */
  providerRef: string;
}

export interface VerifyResult {
  paid: boolean;
  /** Amount the GATEWAY reports, in major units. Must equal the recorded charge. */
  amount: number;
  /** Currency the GATEWAY reports. Must equal the recorded charge currency. */
  currency: string;
  /** Provider's transaction status string, for the audit trail. */
  status: string;
}

export interface GatewayDriver {
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  verify(providerRef: string, charge: { amount: number; currency: string }): Promise<VerifyResult>;
  /** Best-effort webhook authentication. Never the authority — verify() is. */
  verifyWebhook(rawBody: Buffer, headers: Record<string, any>): { valid: boolean; providerRef?: string };
}

/** Thrown when the gateway rejects the request; surfaced to the operator verbatim. */
export class GatewayError extends Error {
  constructor(public gateway: string, message: string) {
    super(`[${gateway}] ${message}`);
    this.name = 'GatewayError';
  }
}

// ── Drivers ───────────────────────────────────────────────────────────────────
const drivers: Record<string, GatewayDriver> = {};

// ── Paystack ──────────────────────────────────────────────────────────────────
drivers.paystack = {
  async createCheckout({ amount, currency, reference, returnUrl, email }) {
    const resp = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      { email, amount: toMinor(amount), currency, reference, callback_url: returnUrl },
      { headers: { Authorization: `Bearer ${env('PAYSTACK_SECRET_KEY')}` }, timeout: 20000 },
    );
    const data = resp.data?.data;
    if (!data?.authorization_url) throw new GatewayError('paystack', resp.data?.message || 'No checkout URL returned');
    return { checkoutUrl: data.authorization_url, providerRef: String(data.reference || reference) };
  },
  async verify(providerRef) {
    const resp = await axios.get(`https://api.paystack.co/transaction/verify/${encodeURIComponent(providerRef)}`, {
      headers: { Authorization: `Bearer ${env('PAYSTACK_SECRET_KEY')}` }, timeout: 20000,
    });
    const d = resp.data?.data;
    return {
      paid: d?.status === 'success',
      amount: toMajor(d?.amount ?? 0),
      currency: String(d?.currency || '').toUpperCase(),
      status: String(d?.status || 'unknown'),
    };
  },
  verifyWebhook(rawBody, headers) {
    const sig = String(headers['x-paystack-signature'] || '');
    if (!sig) return { valid: false };
    const expected = hmac('sha512', env('PAYSTACK_SECRET_KEY'), rawBody);
    if (!safeEqual(sig, expected)) return { valid: false };
    try { return { valid: true, providerRef: String(JSON.parse(rawBody.toString()).data?.reference || '') }; }
    catch { return { valid: false }; }
  },
};

// ── Flutterwave ───────────────────────────────────────────────────────────────
drivers.flutterwave = {
  async createCheckout({ amount, currency, reference, returnUrl, email }) {
    const resp = await axios.post(
      'https://api.flutterwave.com/v3/payments',
      { tx_ref: reference, amount, currency, redirect_url: returnUrl, customer: { email } },
      { headers: { Authorization: `Bearer ${env('FLUTTERWAVE_SECRET_KEY')}` }, timeout: 20000 },
    );
    const link = resp.data?.data?.link;
    if (!link) throw new GatewayError('flutterwave', resp.data?.message || 'No checkout URL returned');
    return { checkoutUrl: link, providerRef: reference };
  },
  async verify(providerRef) {
    const resp = await axios.get('https://api.flutterwave.com/v3/transactions/verify_by_reference', {
      params: { tx_ref: providerRef },
      headers: { Authorization: `Bearer ${env('FLUTTERWAVE_SECRET_KEY')}` }, timeout: 20000,
    });
    const d = resp.data?.data;
    return {
      paid: d?.status === 'successful',
      amount: Number(d?.amount ?? 0),
      currency: String(d?.currency || '').toUpperCase(),
      status: String(d?.status || 'unknown'),
    };
  },
  verifyWebhook(rawBody, headers) {
    // Flutterwave sends a static secret hash configured in their dashboard.
    const expected = env('FLUTTERWAVE_WEBHOOK_HASH');
    const got = String(headers['verif-hash'] || '');
    if (!expected) return { valid: false };
    if (!got || !safeEqual(got, expected)) return { valid: false };
    try { return { valid: true, providerRef: String(JSON.parse(rawBody.toString()).data?.tx_ref || '') }; }
    catch { return { valid: false }; }
  },
};

// ── Razorpay ──────────────────────────────────────────────────────────────────
drivers.razorpay = {
  async createCheckout({ amount, currency, reference, returnUrl }) {
    const auth = Buffer.from(`${env('RAZORPAY_KEY_ID')}:${env('RAZORPAY_KEY_SECRET')}`).toString('base64');
    const resp = await axios.post(
      'https://api.razorpay.com/v1/payment_links',
      {
        amount: toMinor(amount), currency, reference_id: reference,
        description: `Vault card load ${reference}`,
        callback_url: returnUrl, callback_method: 'get',
      },
      { headers: { Authorization: `Basic ${auth}` }, timeout: 20000 },
    );
    if (!resp.data?.short_url) throw new GatewayError('razorpay', resp.data?.error?.description || 'No checkout URL returned');
    return { checkoutUrl: resp.data.short_url, providerRef: String(resp.data.id) };
  },
  async verify(providerRef) {
    const auth = Buffer.from(`${env('RAZORPAY_KEY_ID')}:${env('RAZORPAY_KEY_SECRET')}`).toString('base64');
    const resp = await axios.get(`https://api.razorpay.com/v1/payment_links/${encodeURIComponent(providerRef)}`, {
      headers: { Authorization: `Basic ${auth}` }, timeout: 20000,
    });
    const d = resp.data;
    return {
      paid: d?.status === 'paid',
      amount: toMajor(d?.amount_paid ?? d?.amount ?? 0),
      currency: String(d?.currency || '').toUpperCase(),
      status: String(d?.status || 'unknown'),
    };
  },
  verifyWebhook(rawBody, headers) {
    const secret = env('RAZORPAY_WEBHOOK_SECRET');
    const sig = String(headers['x-razorpay-signature'] || '');
    if (!secret || !sig) return { valid: false };
    if (!safeEqual(sig, hmac('sha256', secret, rawBody))) return { valid: false };
    try {
      const body = JSON.parse(rawBody.toString());
      return { valid: true, providerRef: String(body?.payload?.payment_link?.entity?.id || '') };
    } catch { return { valid: false }; }
  },
};

// ── Xendit ────────────────────────────────────────────────────────────────────
drivers.xendit = {
  async createCheckout({ amount, currency, reference, returnUrl, email }) {
    const auth = Buffer.from(`${env('XENDIT_SECRET_KEY')}:`).toString('base64');
    const resp = await axios.post(
      'https://api.xendit.co/v2/invoices',
      { external_id: reference, amount, currency, payer_email: email, success_redirect_url: returnUrl },
      { headers: { Authorization: `Basic ${auth}` }, timeout: 20000 },
    );
    if (!resp.data?.invoice_url) throw new GatewayError('xendit', resp.data?.message || 'No checkout URL returned');
    return { checkoutUrl: resp.data.invoice_url, providerRef: String(resp.data.id) };
  },
  async verify(providerRef) {
    const auth = Buffer.from(`${env('XENDIT_SECRET_KEY')}:`).toString('base64');
    const resp = await axios.get(`https://api.xendit.co/v2/invoices/${encodeURIComponent(providerRef)}`, {
      headers: { Authorization: `Basic ${auth}` }, timeout: 20000,
    });
    const d = resp.data;
    return {
      paid: d?.status === 'PAID' || d?.status === 'SETTLED',
      amount: Number(d?.paid_amount ?? d?.amount ?? 0),
      currency: String(d?.currency || '').toUpperCase(),
      status: String(d?.status || 'unknown'),
    };
  },
  verifyWebhook(rawBody, headers) {
    const expected = env('XENDIT_CALLBACK_TOKEN');
    const got = String(headers['x-callback-token'] || '');
    if (!expected) return { valid: false };
    if (!got || !safeEqual(got, expected)) return { valid: false };
    try { return { valid: true, providerRef: String(JSON.parse(rawBody.toString()).id || '') }; }
    catch { return { valid: false }; }
  },
};

// ── Stripe ────────────────────────────────────────────────────────────────────
drivers.stripe = {
  async createCheckout({ amount, currency, reference, returnUrl, email }) {
    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('success_url', returnUrl);
    params.append('cancel_url', returnUrl);
    params.append('client_reference_id', reference);
    if (email) params.append('customer_email', email);
    params.append('line_items[0][quantity]', '1');
    params.append('line_items[0][price_data][currency]', currency.toLowerCase());
    params.append('line_items[0][price_data][unit_amount]', String(toMinor(amount)));
    params.append('line_items[0][price_data][product_data][name]', `Vault card load ${reference}`);

    const resp = await axios.post('https://api.stripe.com/v1/checkout/sessions', params.toString(), {
      headers: { Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 20000,
    });
    if (!resp.data?.url) throw new GatewayError('stripe', resp.data?.error?.message || 'No checkout URL returned');
    return { checkoutUrl: resp.data.url, providerRef: String(resp.data.id) };
  },
  async verify(providerRef) {
    const resp = await axios.get(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(providerRef)}`, {
      headers: { Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}` }, timeout: 20000,
    });
    const d = resp.data;
    return {
      paid: d?.payment_status === 'paid',
      amount: toMajor(d?.amount_total ?? 0),
      currency: String(d?.currency || '').toUpperCase(),
      status: String(d?.payment_status || 'unknown'),
    };
  },
  verifyWebhook(rawBody, headers) {
    const secret = env('STRIPE_WEBHOOK_SECRET');
    const header = String(headers['stripe-signature'] || '');
    if (!secret || !header) return { valid: false };
    // Stripe signs "<timestamp>.<raw body>" and sends t= and v1= in the header.
    const parts: Record<string, string> = {};
    header.split(',').forEach((kv) => { const [k, v] = kv.split('='); if (k && v) parts[k.trim()] = v.trim(); });
    if (!parts.t || !parts.v1) return { valid: false };
    if (!safeEqual(parts.v1, hmac('sha256', secret, `${parts.t}.${rawBody.toString()}`))) return { valid: false };
    // Reject replays older than 5 minutes.
    if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return { valid: false };
    try {
      const body = JSON.parse(rawBody.toString());
      return { valid: true, providerRef: String(body?.data?.object?.id || '') };
    } catch { return { valid: false }; }
  },
};

// ── PayPal ────────────────────────────────────────────────────────────────────
async function paypalToken(): Promise<string> {
  const auth = Buffer.from(`${env('PAYPAL_CLIENT_ID')}:${env('PAYPAL_CLIENT_SECRET')}`).toString('base64');
  const resp = await axios.post(`${PAYPAL_BASE()}/v1/oauth2/token`, 'grant_type=client_credentials', {
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000,
  });
  if (!resp.data?.access_token) throw new GatewayError('paypal', 'Could not obtain an access token');
  return resp.data.access_token;
}

drivers.paypal = {
  async createCheckout({ amount, currency, reference, returnUrl }) {
    const token = await paypalToken();
    const resp = await axios.post(`${PAYPAL_BASE()}/v2/checkout/orders`, {
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: reference, amount: { currency_code: currency, value: formatForPaypal(amount, currency) } }],
      payment_source: { paypal: { experience_context: { return_url: returnUrl, cancel_url: returnUrl, user_action: 'PAY_NOW' } } },
    }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 20000 });

    const links = resp.data?.links || [];
    const url = (links.find((l: any) => l.rel === 'payer-action') || links.find((l: any) => l.rel === 'approve'))?.href;
    if (!url) throw new GatewayError('paypal', resp.data?.message || 'No approval URL returned');
    return { checkoutUrl: url, providerRef: String(resp.data.id) };
  },
  async verify(providerRef) {
    const token = await paypalToken();
    const resp = await axios.get(`${PAYPAL_BASE()}/v2/checkout/orders/${encodeURIComponent(providerRef)}`, {
      headers: { Authorization: `Bearer ${token}` }, timeout: 20000,
    });
    const d = resp.data;
    const pu = d?.purchase_units?.[0];
    const captured = pu?.payments?.captures?.find((c: any) => c.status === 'COMPLETED');
    return {
      paid: d?.status === 'COMPLETED' && Boolean(captured),
      amount: Number(captured?.amount?.value ?? pu?.amount?.value ?? 0),
      currency: String(captured?.amount?.currency_code ?? pu?.amount?.currency_code ?? '').toUpperCase(),
      status: `${d?.status || 'unknown'}/${captured?.status || 'not-captured'}`,
    };
  },
  verifyWebhook(rawBody, headers) {
    // PayPal asks you to confirm the notification against their own API rather
    // than compute a local HMAC. That call is async, so the synchronous webhook
    // signature check is skipped and verify() remains the authority.
    let providerRef = '';
    try {
      const body = JSON.parse(rawBody.toString());
      providerRef = String(body?.resource?.id || body?.resource?.supplementary_data?.related_ids?.order_id || '');
    } catch { /* ignore */ }
    return { valid: Boolean(env('PAYPAL_WEBHOOK_ID')), providerRef };
  },
};

// ── Shift4 ────────────────────────────────────────────────────────────────────
drivers.shift4 = {
  async createCheckout({ amount, currency, reference, returnUrl }) {
    const resp = await axios.post('https://api.shift4.com/checkouts', {
      charge: { amount: toMinor(amount), currency },
      clientReferenceId: reference,
      // Shift4 returns the payer to this URL once the hosted page completes.
      termsAndConditionsUrl: returnUrl,
    }, { headers: { Authorization: `Bearer ${env('SHIFT4_SECRET_KEY')}` }, timeout: 20000 });

    const url = resp.data?.url || resp.data?.redirectUrl;
    if (!url) throw new GatewayError('shift4', resp.data?.message || resp.data?.error?.message || 'No checkout URL returned');
    return { checkoutUrl: url, providerRef: String(resp.data.id) };
  },
  async verify(providerRef) {
    const resp = await axios.get(`https://api.shift4.com/checkouts/${encodeURIComponent(providerRef)}`, {
      headers: { Authorization: `Bearer ${env('SHIFT4_SECRET_KEY')}` }, timeout: 20000,
    });
    const d = resp.data;
    const charge = d?.charge;
    return {
      paid: charge?.captured === true || charge?.refunded === false && charge?.captured === true,
      amount: toMajor(charge?.amount ?? 0),
      currency: String(charge?.currency || '').toUpperCase(),
      status: String(charge?.status || d?.status || 'unknown'),
    };
  },
  verifyWebhook(rawBody, headers) {
    const secret = env('SHIFT4_WEBHOOK_SECRET');
    const sig = String(headers['shift4-signature'] || '');
    if (!secret || !sig) return { valid: false };
    if (!safeEqual(sig, hmac('sha256', secret, rawBody))) return { valid: false };
    try {
      const body = JSON.parse(rawBody.toString());
      return { valid: true, providerRef: String(body?.data?.id || '') };
    } catch { return { valid: false }; }
  },
};

/** Resolve a usable driver, or throw a GatewayError explaining why not. */
export function getDriver(gatewayId: string): GatewayDriver {
  const def = getGateway(gatewayId);
  if (!def) throw new GatewayError(gatewayId, 'Unknown gateway');
  if (!def.implemented) throw new GatewayError(gatewayId, def.note || 'Not implemented yet');
  if (!gatewayIsConfigured(def)) {
    throw new GatewayError(gatewayId, gatewayUnavailableReason(def) || 'Not configured');
  }
  const driver = drivers[gatewayId];
  if (!driver) throw new GatewayError(gatewayId, 'No driver registered');
  return driver;
}

export { toMinor, toMajor };
