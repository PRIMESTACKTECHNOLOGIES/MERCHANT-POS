/**
 * Payout wire-file generator
 * ─────────────────────────────────────────────────────────────────────────────
 * Turns a merchant payout into the payment files the destination bank accepts,
 * so an operator can upload them to the bank instead of waiting for a live API:
 *
 *   • SWIFT MT103   — ISO 15022 single customer credit transfer (any currency)
 *   • SEPA pain.001 — ISO 20022 credit transfer initiation (EUR / IBAN)
 *
 * The debtor (ordering party) is the configured settlement account read from the
 * MT103_SENDER_* env vars; the creditor (beneficiary) is the payout's resolved
 * bank account — e.g. the German Banking Circle account DE96… / SXPYDEHH.
 *
 * Files are persisted so they can be downloaded and reconciled later; a missing
 * or invalid beneficiary never fails the payout, it is reported in `errors`.
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import { buildMt103FromPayout, generateMt103 } from './mt103.service';
import { buildFullSepaXml, type SepaTransaction } from '../payments/authenticationEngine.service';

export interface PayoutWireInput {
  merchantId: string;
  payoutId: string;
  amount: number;
  currency: string;
  bankAccount: any;
  remittanceInfo?: string;
}

export interface PayoutWireResult {
  mt103?: { id: string; uetr: string; reference: string; value_date: string; download_url: string };
  sepa?: { id: string; msg_id: string; end_to_end_id: string; download_url: string };
  errors: string[];
}

/** Idempotently creates the tables holding generated wire files. */
export async function ensurePayoutWireTables(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS mt103_payouts (
      id                TEXT PRIMARY KEY,
      merchant_id       TEXT NOT NULL,
      payout_id         TEXT,
      uetr              TEXT NOT NULL,
      internal_reference TEXT NOT NULL,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      value_date        TEXT NOT NULL,
      sender_bic        TEXT,
      sender_account    TEXT,
      sender_name       TEXT,
      beneficiary_bic   TEXT,
      beneficiary_account TEXT,
      beneficiary_name  TEXT,
      remittance_info   TEXT,
      charge_bearer     TEXT DEFAULT 'SHA',
      mt103_message     TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'DRAFT',
      sent_at           TEXT,
      confirmed_at      TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS sepa_payout_files (
      id             TEXT PRIMARY KEY,
      merchant_id    TEXT NOT NULL,
      payout_id      TEXT,
      msg_id         TEXT NOT NULL,
      end_to_end_id  TEXT NOT NULL,
      amount         REAL NOT NULL,
      currency       TEXT NOT NULL DEFAULT 'EUR',
      debtor_name    TEXT,
      debtor_iban    TEXT,
      debtor_bic     TEXT,
      creditor_name  TEXT,
      creditor_iban  TEXT,
      creditor_bic   TEXT,
      remittance_info TEXT,
      xml            TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'DRAFT',
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/** SWIFT MT103 wire instruction for the payout's beneficiary bank. */
async function buildMt103File(input: PayoutWireInput) {
  const mt103Input = buildMt103FromPayout({
    payoutId: input.payoutId,
    amount: input.amount,
    currency: input.currency,
    bankAccount: input.bankAccount,
    merchantId: input.merchantId,
    remittanceInfo: input.remittanceInfo,
  });

  const result = generateMt103(mt103Input);
  const id = uuidv4();

  await db.query(`
    INSERT INTO mt103_payouts
      (id, merchant_id, payout_id, uetr, internal_reference, amount, currency,
       value_date, sender_bic, sender_account, sender_name,
       beneficiary_bic, beneficiary_account, beneficiary_name,
       remittance_info, charge_bearer, mt103_message, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',datetime('now'))
  `, [
    id, input.merchantId, input.payoutId, result.uetr,
    result.reference, result.amount, result.currency,
    result.valueDate,
    mt103Input.senderBic, mt103Input.senderAccount, mt103Input.senderName,
    mt103Input.beneficiaryBic, mt103Input.beneficiaryAccount, mt103Input.beneficiaryName,
    mt103Input.remittanceInfo || null,
    mt103Input.chargeBearer || 'SHA',
    result.message,
  ]);

  return {
    id,
    uetr: result.uetr,
    reference: result.reference,
    value_date: result.valueDate,
    download_url: `/api/payout/mt103/download/${id}`,
  };
}

/** SEPA pain.001 credit transfer instruction — EUR / IBAN beneficiaries only. */
async function buildSepaFile(input: PayoutWireInput) {
  const endToEndId = input.payoutId.replace(/[^A-Za-z0-9]/g, '').slice(0, 35).toUpperCase();
  const msgId = `POS-SEPA-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${endToEndId.slice(0, 8)}`;

  const transaction: SepaTransaction = {
    id: input.payoutId,
    amount: input.amount,
    currency: input.currency,
    beneficiaryName: input.bankAccount?.account_holder || '',
    beneficiaryIban: input.bankAccount?.iban || '',
    beneficiaryBic: input.bankAccount?.swift_code || '',
    reference: input.remittanceInfo || `POS SETTLEMENT ${input.merchantId}`,
    endToEndId,
  };

  const debtorName = process.env.MT103_SENDER_NAME?.trim() || '';
  const debtorIban = process.env.MT103_SENDER_ACCOUNT?.trim() || '';
  const debtorBic = process.env.MT103_SENDER_BIC?.trim() || '';

  const xml = buildFullSepaXml([transaction], { debtorName, debtorIban, debtorBic, msgId });
  const id = uuidv4();

  await db.query(`
    INSERT INTO sepa_payout_files
      (id, merchant_id, payout_id, msg_id, end_to_end_id, amount, currency,
       debtor_name, debtor_iban, debtor_bic, creditor_name, creditor_iban,
       creditor_bic, remittance_info, xml, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',datetime('now'))
  `, [
    id, input.merchantId, input.payoutId, msgId, endToEndId, input.amount, input.currency,
    debtorName, debtorIban, debtorBic,
    transaction.beneficiaryName, transaction.beneficiaryIban, transaction.beneficiaryBic,
    transaction.reference || null, xml,
  ]);

  return {
    id,
    msg_id: msgId,
    end_to_end_id: endToEndId,
    download_url: `/api/payout/wire/sepa/${id}/download`,
  };
}

/**
 * Generates and stores the SEPA / MT103 wire files for a payout.
 * Never throws: a file that cannot be built (missing IBAN, bad BIC, …) is
 * reported in `errors` so the payout itself still completes.
 */
export async function generatePayoutWireFiles(input: PayoutWireInput): Promise<PayoutWireResult> {
  const result: PayoutWireResult = { errors: [] };

  try {
    await ensurePayoutWireTables();
  } catch (e: any) {
    result.errors.push(`wire tables: ${e.message}`);
    return result;
  }

  try {
    result.mt103 = await buildMt103File(input);
  } catch (e: any) {
    result.errors.push(`MT103: ${e.message}`);
  }

  const currency = String(input.currency || '').toUpperCase();
  if (currency === 'EUR' && input.bankAccount?.iban) {
    try {
      result.sepa = await buildSepaFile(input);
    } catch (e: any) {
      result.errors.push(`SEPA: ${e.message}`);
    }
  }

  return result;
}

/** Raw SEPA pain.001 XML for download. */
export async function getSepaPayoutFile(id: string) {
  await ensurePayoutWireTables();
  const res = await db.query(`SELECT * FROM sepa_payout_files WHERE id = ? LIMIT 1`, [id]);
  return res.rows[0] || null;
}

/** Every generated wire file for a merchant, newest first. */
export async function listPayoutWireFiles(merchantId: string, limit = 100) {
  await ensurePayoutWireTables();
  const mt103 = await db.query(
    `SELECT id, payout_id, uetr, internal_reference, amount, currency, value_date,
            beneficiary_name, beneficiary_iban AS beneficiary_account, status, created_at
       FROM mt103_payouts WHERE merchant_id = ?
      ORDER BY created_at DESC LIMIT ?`,
    [merchantId, limit]
  );
  const sepa = await db.query(
    `SELECT id, payout_id, msg_id, end_to_end_id, amount, currency,
            creditor_name, creditor_iban, status, created_at
       FROM sepa_payout_files WHERE merchant_id = ?
      ORDER BY created_at DESC LIMIT ?`,
    [merchantId, limit]
  );
  return {
    mt103: mt103.rows,
    sepa: sepa.rows,
  };
}
