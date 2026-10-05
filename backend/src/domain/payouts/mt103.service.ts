/**
 * MT103 SWIFT Wire Generator
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates ISO 15022 MT103 Single Customer Credit Transfer messages.
 * Used by your internal acquirer (Protocol 201.3) to produce SWIFT wire
 * instructions that can be uploaded to a bank or sent to a correspondent.
 *
 * Reference: SWIFT MT103 Field Specifications
 */

import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';

export interface Mt103Payout {
  // Sender (your side)
  senderBic:          string;   // e.g. PRSTUS33XXX (PRIMESTACK)
  senderAccount:      string;   // settlement account
  senderName:         string;   // PRIMESTACK TECHNOLOGIES LLC
  senderAddressLines: string[]; // ['BUSINESS BAY', 'DUBAI, UAE']

  // Beneficiary (receiving side)
  beneficiaryBic:          string;   // 
  beneficiaryAccount:      string;   // 
  beneficiaryName:         string;   // JUKRUTI LOGISTICS PTY LTD
  beneficiaryAddressLines: string[]; // ['9 HOUTKAPPER STR', 'OLIFANTSHOEK 8450', 'SOUTH AFRICA']

  // Payment details
  amount:            number;  // 25000.00
  currency:          string;  // USD
  valueDate:         string;  // YYYYMMDD

  // References
  internalReference: string;  // INTL-MRC-1001-0001
  remittanceInfo?:   string;  // POS SETTLEMENT BATCH ...
  chargeBearer?:     'SHA' | 'OUR' | 'BEN';
  uetr?:             string;  // UUIDv4 — auto-generated if not provided
}

export interface Mt103Result {
  uetr:       string;
  message:    string;   // full MT103 text
  reference:  string;
  valueDate:  string;
  amount:     number;
  currency:   string;
}

/**
 * Format amount as SWIFT :32A: — comma as decimal separator, no thousands separator
 * e.g. 25000.00 → "25000,00"
 */
function formatSwiftAmount(amount: number): string {
  return amount.toFixed(2).replace('.', ',');
}

function normalizeYyyyMmDd(valueDate: string): string {
  const digits = String(valueDate || '').replace(/[^0-9]/g, '');
  if (digits.length >= 8) return digits.slice(0, 8);
  if (digits.length === 6) return `20${digits.slice(0, 2)}${digits.slice(2, 4)}${digits.slice(4, 6)}`;
  return '';
}

function toSwiftYyMmDd(valueDate: string): string {
  const ymd = normalizeYyyyMmDd(valueDate);
  if (!ymd) return '';
  return `${ymd.slice(2, 4)}${ymd.slice(4, 6)}${ymd.slice(6, 8)}`;
}

function normalizeBic11(bic: string): string {
  const v = String(bic || '').toUpperCase().replace(/\s+/g, '');
  const cleaned = v.replace(/[{}:]/g, '');
  const m = cleaned.match(/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/);
  if (!m) return '';
  return cleaned.length === 8 ? `${cleaned}XXX` : cleaned;
}

function bic12ForHeaders(bic: string): string {
  const b11 = normalizeBic11(bic);
  if (!b11) return '';
  return `${b11}X`;
}

/**
 * Truncate/pad a SWIFT field to max length
 */
function swiftField(value: string, maxLen: number): string {
  return String(value || '').replace(/[\r\n]/g, ' ').slice(0, maxLen).replace(/[{}:]/g, '');
}

function splitSwiftLines(value: string, maxLineLen: number, maxLines: number): string[] {
  const v = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const src = v.split('\n').map(x => x.trim()).filter(Boolean).join(' ');
  const cleaned = swiftField(src, maxLineLen * maxLines);
  const out: string[] = [];
  let i = 0;
  while (i < cleaned.length && out.length < maxLines) {
    out.push(cleaned.slice(i, i + maxLineLen));
    i += maxLineLen;
  }
  return out;
}

function validateMt103Payout(p: Mt103Payout) {
  const senderBic11 = normalizeBic11(p.senderBic);
  const beneBic11 = normalizeBic11(p.beneficiaryBic);
  const ymd = normalizeYyyyMmDd(p.valueDate);
  const swiftDate = toSwiftYyMmDd(p.valueDate);
  const ccy = String(p.currency || '').toUpperCase();
  const charge = p.chargeBearer || 'SHA';

  const errors: string[] = [];

  if (!senderBic11) errors.push('senderBic must be a valid BIC8 or BIC11');
  if (!beneBic11) errors.push('beneficiaryBic must be a valid BIC8 or BIC11');
  if (!swiftDate) errors.push('valueDate must be YYMMDD or YYYYMMDD');
  if (!ymd) errors.push('valueDate must be YYMMDD or YYYYMMDD');
  if (!/^[A-Z]{3}$/.test(ccy)) errors.push('currency must be a 3-letter ISO code');
  if (!Number.isFinite(p.amount) || p.amount <= 0) errors.push('amount must be a positive number');
  if (!p.internalReference) errors.push('internalReference is required');
  if (!p.senderAccount) errors.push('senderAccount is required');
  if (!p.senderName) errors.push('senderName is required');
  if (!p.beneficiaryAccount) errors.push('beneficiaryAccount is required');
  if (!p.beneficiaryName) errors.push('beneficiaryName is required');
  if (!['SHA', 'OUR', 'BEN'].includes(charge)) errors.push('chargeBearer must be SHA, OUR, or BEN');

  const senderAddrCount = Array.isArray(p.senderAddressLines) ? p.senderAddressLines.filter(Boolean).length : 0;
  const beneAddrCount = Array.isArray(p.beneficiaryAddressLines) ? p.beneficiaryAddressLines.filter(Boolean).length : 0;
  if (senderAddrCount > 3) errors.push('senderAddressLines max is 3');
  if (beneAddrCount > 3) errors.push('beneficiaryAddressLines max is 3');

  if (errors.length) {
    throw new Error(`MT103 validation failed: ${errors.join('; ')}`);
  }
}

/**
 * Generate a full MT103 message string
 */
export function generateMt103(p: Mt103Payout): Mt103Result {
  validateMt103Payout(p);

  const uetr = (p.uetr || uuidv4()).toUpperCase();
  const ref = swiftField(p.internalReference, 16);
  const amtStr = formatSwiftAmount(p.amount);
  const ccy = String(p.currency || 'USD').toUpperCase().slice(0, 3);
  const charge = p.chargeBearer || 'SHA';

  const valueDate = normalizeYyyyMmDd(p.valueDate);
  const swiftDate = toSwiftYyMmDd(valueDate);

  const senderBic11 = normalizeBic11(p.senderBic);
  const beneBic11 = normalizeBic11(p.beneficiaryBic);
  const senderBic12 = bic12ForHeaders(senderBic11);
  const beneBic12 = bic12ForHeaders(beneBic11);

  // Block 1 — Basic Header (logical terminal)
  const block1 = `{1:F01${senderBic12}0000000000}`;

  // Block 2 — Application Header (output, MT103)
  const block2 = `{2:O1031200${swiftDate}${beneBic12}0000000000${swiftDate}1200N}`;

  // Block 3 — User Header with UETR (Unique End-to-End Transaction Reference)
  const block3 = `{3:{121:${uetr}}}`;

  // Block 4 — Text block
  const lines: string[] = ['{4:'];

  // :20: Transaction Reference Number
  lines.push(`:20:${ref}`);

  // :23B: Bank Operation Code
  lines.push(':23B:CRED');

  // :32A: Value Date / Currency / Amount
  lines.push(`:32A:${swiftDate}${ccy}${amtStr}`);

  // :50K: Ordering Customer (Sender)
  lines.push(`:50K:/${swiftField(p.senderAccount, 34)}`);
  lines.push(swiftField(p.senderName, 35));
  p.senderAddressLines.slice(0, 3).forEach(line => {
    lines.push(swiftField(line, 35));
  });

  // :52A: Ordering Institution (Sender BIC)
  lines.push(`:52A:${swiftField(p.senderBic, 11)}`);

  // :57A: Account with Institution (Beneficiary bank BIC)
  lines.push(`:57A:${swiftField(p.beneficiaryBic, 11)}`);

  // :59: Beneficiary Customer
  lines.push(`:59:/${swiftField(p.beneficiaryAccount, 34)}`);
  lines.push(swiftField(p.beneficiaryName, 35));
  p.beneficiaryAddressLines.slice(0, 3).forEach(line => {
    lines.push(swiftField(line, 35));
  });

  // :70: Remittance Information
  if (p.remittanceInfo) {
    const remLines = splitSwiftLines(p.remittanceInfo, 35, 4);
    if (remLines.length) {
      lines.push(`:70:${remLines[0]}`);
      remLines.slice(1).forEach(l => lines.push(l));
    }
  }

  // :71A: Details of Charges
  lines.push(`:71A:${charge}`);

  lines.push('-}');

  const block4 = lines.join('\n');

  // Block 5 — Trailer (checksum placeholder)
  const chk = createHash('sha256').update([block1, block2, block3, block4].join('')).digest('hex').slice(0, 12).toUpperCase();
  const block5 = `{5:{CHK:${chk}}}`;

  const message = [block1, block2, block3, block4, block5].join('');

  return {
    uetr,
    message,
    reference: ref,
    valueDate,
    amount: p.amount,
    currency: ccy,
  };
}

/**
 * Build Mt103Payout from a merchant payout record + bank account
 * Uses your system defaults for sender details
 */
export function buildMt103FromPayout(params: {
  payoutId:      string;
  amount:        number;
  currency:      string;
  bankAccount:   any;
  merchantId:    string;
  remittanceInfo?: string;
}): Mt103Payout {
  // Value date = today
  const today = new Date();
  const valueDate = [
    today.getFullYear().toString(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('');

  return {
    // Sender — your PRIMESTACK / internal acquirer details
    senderBic:     process.env.MT103_SENDER_BIC    || 'PRSTUS33XXX',
    senderAccount: process.env.MT103_SENDER_ACCOUNT || '343612919064346',
    senderName:    process.env.MT103_SENDER_NAME    || 'PRIMESTACK TECHNOLOGIES LLC',
    senderAddressLines: (process.env.MT103_SENDER_ADDRESS || 'BUSINESS BAY,DUBAI, UAE').split(','),

    // Beneficiary — from the bank account record
    beneficiaryBic:     params.bankAccount?.swift_code     || '',
    beneficiaryAccount: params.bankAccount?.account_number || '',
    beneficiaryName:    params.bankAccount?.account_holder || '',
    beneficiaryAddressLines: [
      params.bankAccount?.bank_address || '',
    ].filter(Boolean),

    // Payment
    amount:            params.amount,
    currency:          params.currency || 'USD',
    valueDate,
    internalReference: params.payoutId.slice(0, 16).toUpperCase(),
    remittanceInfo:    params.remittanceInfo || `POS SETTLEMENT ${params.merchantId} REF ${params.payoutId.slice(0, 8)}`,
    chargeBearer:      'SHA',
    uetr:              uuidv4().toUpperCase(),
  };
}
