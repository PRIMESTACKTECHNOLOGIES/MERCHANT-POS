/**
 * batchfile.router.ts
 *
 * Generates downloadable settlement batch files for customers to upload
 * to their bank and initiate payment to the merchant.
 *
 * Supported formats:
 *   GET /api/batch-file/csv       → CSV (universal, most banks accept)
 *   GET /api/batch-file/mt103     → MT103 SWIFT (international wire)
 *   GET /api/batch-file/summary   → JSON summary of what will be in the file
 *
 * Merchant (beneficiary / receiver of funds):
 *   PRIMESTACK TECHNOLOGIES LLC
 *   Wise US / Column Bank
 *   Routing: 084009519
 *   Account: 343612919064346
 *   SWIFT:   TRWIUS35XXX
 *
 * Customer (payer / sender of funds) details are pre-filled from:
 *   - Default: EXPLORE RESIN HANDICRAFTS / RAK Bank UAE
 *   - Can be overridden via query params
 */

import { Router, Request, Response } from 'express';
import { db } from '../../config/db';

const router = Router();

// ── Merchant (beneficiary) details — PRIMESTACK TECHNOLOGIES LLC ─────────────
const MERCHANT = {
  name:           'PRIMESTACK TECHNOLOGIES LLC',
  accountType:    'Deposit',
  routingNumber:  '084009519',          // Wise US / Column Bank (ACH/wire)
  accountNumber:  '343612919064346',
  bankName:       'Column Bank (via Wise US Inc)',
  bankAddress:    'Wise US Inc, 108 W 13th St, Wilmington, DE 19801, United States',
  swiftBic:       'TRWIUS35XXX',
  currency:       'USD',
};

// ── Default customer (payer) details — EXPLORE RESIN HANDICRAFTS ─────────────
const DEFAULT_CUSTOMER = {
  name:          'EXPLORE RESIN HANDICRAFTS',
  bankName:      'RAK BANK',
  bankCountry:   'United Arab Emirates',
  accountNumber: '0333700319001',
  iban:          'AE910400000333700319001',
  branch:        'Umm Hurrair, Dubai',
  swiftBic:      'RAKBAEADXXX',         // RAK Bank SWIFT code
};

// ── Fetch all unsettled transactions ─────────────────────────────────────────
async function getUnsettledTransactions(merchantId?: string) {
  const where = merchantId ? `WHERE t.merchant_id = ?` : '';
  const params = merchantId ? [merchantId] : [];

  const res = await db.query(
    `SELECT
       t.id, t.merchant_id, t.terminal_id, t.local_txn_id, t.stan,
       t.amount_minor, t.currency, t.pan_masked, t.card_brand,
       t.txn_type, t.entry_mode, t.auth_mode, t.status,
       t.txn_timestamp, t.created_at
     FROM pos2013_transactions t
     LEFT JOIN pos2013_batches b
       ON b.batch_id = t.batch_id AND b.merchant_id = t.merchant_id
     ${where}
     AND (b.status IS NULL OR b.status != 'PROCESSED')
     ORDER BY t.created_at ASC`,
    params
  );
  return res.rows as any[];
}

// ── Format helpers ────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

function fmtAmount(minor: number, currency: string) {
  return (minor / 100).toFixed(2) + ' ' + currency;
}

function mt103Date(iso: string) {
  // YYMMDD format for MT103
  const d = new Date(iso);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return yy + mm + dd;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /summary  — JSON overview of what the batch file contains
// ─────────────────────────────────────────────────────────────────────────────
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const merchantId = (req.query.merchantId as string) ||
      (req.headers['x-merchant-id'] as string);

    const txns = await getUnsettledTransactions(merchantId);

    // Group by currency
    const byCurrency: Record<string, { count: number; totalMinor: number }> = {};
    for (const t of txns) {
      if (!byCurrency[t.currency]) byCurrency[t.currency] = { count: 0, totalMinor: 0 };
      byCurrency[t.currency].count++;
      byCurrency[t.currency].totalMinor += Number(t.amount_minor);
    }

    const totalUSD = txns
      .filter(t => t.currency === 'USD')
      .reduce((s: number, t: any) => s + Number(t.amount_minor), 0) / 100;

    res.json({
      ok: true,
      totalTransactions: txns.length,
      totalUSD,
      byCurrency: Object.entries(byCurrency).map(([currency, v]) => ({
        currency,
        count: v.count,
        total: (v.totalMinor / 100).toFixed(2),
      })),
      merchant: MERCHANT,
      customer: DEFAULT_CUSTOMER,
      generatedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /csv  — Wise Batch Payment CSV (exact Wise format)
// Upload through the configured bank provider's batch-payment workflow.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/csv', async (req: Request, res: Response) => {
  try {
    const merchantId = (req.query.merchantId as string) ||
      (req.headers['x-merchant-id'] as string);

    const txns = await getUnsettledTransactions(merchantId);

    if (txns.length === 0) {
      return res.status(404).json({ ok: false, error: 'No unsettled transactions found.' });
    }

    const totalMinorUSD = txns
      .filter((t: any) => t.currency === 'USD')
      .reduce((s: number, t: any) => s + Number(t.amount_minor), 0);

    const totalUSD = (totalMinorUSD / 100).toFixed(2);
    const refNo    = `PSTK-${Date.now()}`;
    const now      = new Date().toISOString().slice(0, 10);

    // ── Wise Batch CSV exact column order ─────────────────────────────────
    // Keep the generated batch format aligned with the configured provider.
    // Columns:
    //   name, recipientEmail, paymentReference, receiverType,
    //   amountCurrency, amount, sourceCurrency, targetCurrency,
    //   accountHolderName (= name again), accountNumber, IBAN,
    //   bankName, swiftCode, nationality, dateOfBirth,
    //   addressCountry, addressCity, addressFirstLine,
    //   addressState, transferPurpose

    const WISE_HEADER = [
      'name',
      'recipientEmail',
      'paymentReference',
      'receiverType',
      'amountCurrency',
      'amount',
      'sourceCurrency',
      'targetCurrency',
      'accountHolderName',
      'accountNumber',
      'IBAN',
      'bankName',
      'swiftCode',
      'nationality',
      'dateOfBirth',
      'addressCountry',
      'addressCity',
      'addressFirstLine',
      'addressState',
      'transferPurpose',
    ].join(',');

    // One row per transaction
    const rows: string[] = txns.map((t: any) => {
      const amount   = (Number(t.amount_minor) / 100).toFixed(2);
      const currency = t.currency || 'USD';
      const txnRef   = `${refNo}-${t.stan || t.id?.slice(0, 8) || 'TXN'}`;

      return [
        `"${MERCHANT.name}"`,           // name
        `""`,                            // recipientEmail (not required for bank transfer)
        `"${txnRef}"`,                   // paymentReference
        `"BUSINESS"`,                    // receiverType
        `"${currency}"`,                 // amountCurrency
        `"${amount}"`,                   // amount
        `"${currency}"`,                 // sourceCurrency
        `"USD"`,                         // targetCurrency
        `"${MERCHANT.name}"`,            // accountHolderName
        `"${MERCHANT.accountNumber}"`,   // accountNumber
        `""`,                            // IBAN (US accounts use routing+account, not IBAN)
        `"${MERCHANT.bankName}"`,        // bankName
        `"${MERCHANT.swiftBic}"`,        // swiftCode
        `""`,                            // nationality
        `""`,                            // dateOfBirth
        `"US"`,                          // addressCountry
        `"Wilmington"`,                  // addressCity
        `"108 W 13th St"`,               // addressFirstLine
        `"DE"`,                          // addressState
        `"SERVICES"`,                    // transferPurpose
      ].join(',');
    });

    // Summary row (total)
    const summaryRow = [
      `"TOTAL SETTLEMENT"`,
      `""`,
      `"${refNo}"`,
      `"BUSINESS"`,
      `"USD"`,
      `"${totalUSD}"`,
      `"USD"`,
      `"USD"`,
      `"${MERCHANT.name}"`,
      `"${MERCHANT.accountNumber}"`,
      `""`,
      `"${MERCHANT.bankName}"`,
      `"${MERCHANT.swiftBic}"`,
      `""`,
      `""`,
      `"US"`,
      `"Wilmington"`,
      `"108 W 13th St"`,
      `"DE"`,
      `"SERVICES"`,
    ].join(',');

    const csvLines = [WISE_HEADER, ...rows];
    const csvContent = csvLines.join('\r\n');
    const filename = `wise_batch_${now}_${refNo}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /mt103  — MT103 SWIFT wire transfer instruction file
// One MT103 message per currency (bank standard for international wires)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/mt103', async (req: Request, res: Response) => {
  try {
    const merchantId = (req.query.merchantId as string) ||
      (req.headers['x-merchant-id'] as string);

    const customerName    = (req.query.customerName    as string) || DEFAULT_CUSTOMER.name;
    const customerIban    = (req.query.customerIban    as string) || DEFAULT_CUSTOMER.iban;
    const customerBank    = (req.query.customerBank    as string) || DEFAULT_CUSTOMER.bankName;
    const customerSwift   = (req.query.customerSwift   as string) || DEFAULT_CUSTOMER.swiftBic;

    const txns = await getUnsettledTransactions(merchantId);
    if (txns.length === 0) {
      return res.status(404).json({ ok: false, error: 'No unsettled transactions found.' });
    }

    // Group by currency — one MT103 per currency
    const byCurrency: Record<string, any[]> = {};
    for (const t of txns) {
      if (!byCurrency[t.currency]) byCurrency[t.currency] = [];
      byCurrency[t.currency].push(t);
    }

    const now = new Date();
    const dateStr = mt103Date(now.toISOString());
    const blocks: string[] = [];

    for (const [currency, ctxns] of Object.entries(byCurrency)) {
      const totalMinor = ctxns.reduce((s: number, t: any) => s + Number(t.amount_minor), 0);
      const totalAmount = (totalMinor / 100).toFixed(2);
      const refNo = `PSTK${dateStr}${currency}`;
      const txnRef = `POS-SETTLE-${currency}-${Date.now()}`;

      // MT103 format (SWIFT Customer Credit Transfer)
      const mt103Lines = [
        `{1:F01${customerSwift}0000000000}`,
        `{2:I103${MERCHANT.swiftBic}N}`,
        `{4:`,
        `:20:${txnRef.slice(0, 16)}`,           // Transaction Reference Number
        `:23B:CRED`,                              // Bank Operation Code
        `:32A:${dateStr}${currency}${totalAmount.replace('.', ',')}`, // Value Date + Currency + Amount
        `:50K:/${customerIban}`,                  // Ordering Customer (Payer)
        `${customerName}`,
        `${customerBank}`,
        `:52A:${customerSwift}`,                  // Ordering Institution (Payer's Bank)
        `:57A:${MERCHANT.swiftBic}`,              // Account With Institution (Beneficiary Bank)
        `:59:/${MERCHANT.accountNumber}`,          // Beneficiary Customer (Merchant)
        `${MERCHANT.name}`,
        `${MERCHANT.bankAddress.slice(0, 35)}`,
        `:70:/RFB/${refNo}`,                      // Remittance Information
        `POS SETTLEMENT ${txns.length} TXNS`,
        `:71A:SHA`,                               // Details of Charges (shared)
        `-}`,
        ``,
        `--- TRANSACTION DETAIL (${currency}) ---`,
      ];

      // Append transaction list as reference block
      ctxns.forEach((t: any, i: number) => {
        mt103Lines.push(
          `${String(i + 1).padStart(3, '0')} | ${fmtDate(t.txn_timestamp || t.created_at)} | ` +
          `${t.pan_masked || '****'} | ${(Number(t.amount_minor) / 100).toFixed(2)} ${t.currency} | ` +
          `${t.card_brand || 'CARD'} | ${t.entry_mode || ''} | ${t.stan || ''}`
        );
      });

      mt103Lines.push(`SUBTOTAL ${currency}: ${totalAmount}`);
      mt103Lines.push(`---`);

      blocks.push(mt103Lines.join('\n'));
    }

    const fullContent = blocks.join('\n\n');
    const filename = `MT103_settlement_${dateStr}.txt`;

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(fullContent);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export { router as batchFileRouter };
