import { db } from './db';

/**
 * merchantBank — the RECEIVING bank account for settled merchant funds.
 *
 * The receiver of the funds is the merchant's own bank account. Two sources feed it:
 *   1. env vars  (MERCHANT_BANK_* / MERCHANT_IBAN / MERCHANT_BIC) — highest priority
 *   2. merchant_settings bank_* columns — filled from the Merchant Settings page
 *
 * Env wins so an operator can point the receiver at a real bank account per
 * deployment without touching the database.
 */

export interface MerchantBankAccount {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  iban: string;
  swiftCode: string;
  routingNumber: string;
  bankAddress: string;
  currency: string;
  country: string;
  accountLast4: string;
  source: 'env' | 'settings' | 'none';
}

const clean = (v: unknown): string => String(v ?? '').trim();

function firstEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = clean(process.env[key]);
    if (value) return value;
  }
  return '';
}

export function accountLast4(accountNumber?: string | null, iban?: string | null): string {
  const alnum = `${accountNumber || ''}${iban || ''}`.replace(/[^0-9A-Za-z]/g, '');
  return alnum.length >= 4 ? alnum.slice(-4) : '';
}

export function maskAccount(accountNumber?: string | null, iban?: string | null): string {
  const last4 = accountLast4(accountNumber, iban);
  return last4 ? `**** ${last4}` : '';
}

/**
 * Display name of the business, used on receipts, batch files and wire headers.
 * Env-driven so a deployment never prints a hardcoded company name.
 */
export function merchantDisplayName(): string {
  return firstEnv('MERCHANT_NAME', 'MERCHANT_BANK_ACCOUNT_HOLDER', 'PROCESSOR_NAME');
}

/** Env-defined receiving bank account (overrides Merchant Settings). */
export function envReceivingBankAccount() {
  return {
    bankName: firstEnv('MERCHANT_BANK_NAME'),
    accountHolder: firstEnv('MERCHANT_BANK_ACCOUNT_HOLDER'),
    accountNumber: firstEnv('MERCHANT_BANK_ACCOUNT_NUMBER'),
    iban: firstEnv('MERCHANT_IBAN', 'MERCHANT_BANK_IBAN'),
    swiftCode: firstEnv('MERCHANT_BIC', 'MERCHANT_BANK_SWIFT_CODE'),
    routingNumber: firstEnv('MERCHANT_BANK_ROUTING_NUMBER'),
    bankAddress: firstEnv('MERCHANT_BANK_ADDRESS'),
    currency: firstEnv('MERCHANT_BANK_CURRENCY'),
    country: firstEnv('MERCHANT_BANK_COUNTRY'),
  };
}

/** True when the resolved account can actually receive a transfer. */
export function isReceivingBankConfigured(account: MerchantBankAccount): boolean {
  return Boolean(account.accountNumber || account.iban);
}

/**
 * Resolve the receiving bank account.
 * Resolution order per field: env var → merchant_settings column.
 */
export async function resolveMerchantBankAccount(merchantId?: string): Promise<MerchantBankAccount> {
  const env = envReceivingBankAccount();

  let row: any = null;
  if (merchantId) {
    try {
      const res = await db.query(
        `SELECT bank_name, bank_account_holder, bank_account_number, bank_routing_number,
                bank_iban, bank_swift_code, bank_address
         FROM merchant_settings WHERE merchant_id = ? LIMIT 1`,
        [merchantId]
      );
      row = res.rows?.[0] || null;
    } catch {
      row = null;
    }
  }

  const pick = (envValue: string, columnValue: unknown) => envValue || clean(columnValue);

  const accountNumber = pick(env.accountNumber, row?.bank_account_number);
  const iban = pick(env.iban, row?.bank_iban);
  const hasEnv = Object.values(env).some((v) => Boolean(v));
  const hasSettings = Boolean(
    row && (row.bank_name || row.bank_account_number || row.bank_iban || row.bank_account_holder)
  );

  return {
    bankName: pick(env.bankName, row?.bank_name),
    accountHolder: pick(env.accountHolder, row?.bank_account_holder),
    accountNumber,
    iban,
    swiftCode: pick(env.swiftCode, row?.bank_swift_code),
    routingNumber: pick(env.routingNumber, row?.bank_routing_number),
    bankAddress: pick(env.bankAddress, row?.bank_address),
    currency: env.currency || 'USD',
    country: env.country,
    accountLast4: accountLast4(accountNumber, iban),
    source: hasEnv ? 'env' : hasSettings ? 'settings' : 'none',
  };
}
