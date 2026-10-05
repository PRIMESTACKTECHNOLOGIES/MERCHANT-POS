/**
 * PRISMA / LaPos POS — High-Level Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Wraps the protocol + client layers into business-level operations:
 *   sale()           → VEN command  — real card capture
 *   cancelSale()     → ANV command  — void a sale by coupon number
 *   refund()         → DEV command  — return funds to cardholder
 *   cancelRefund()   → AND command  — void a refund
 *   close()          → CIE command  — end-of-day batch closure
 *   lastTransaction()→ ULT command  — get last transaction details
 *   lastClose()      → ULC command  — get last close summary
 *   reprintTxn()     → IMT command  — reprint last transaction receipt
 *   reprintClose()   → IMC command  — reprint last close receipt
 *   cardTable()      → TAR command  — list all supported card types
 *   planTable()      → PLA command  — list all payment plans
 *   testConnection() → TES command  — health check
 *
 * After each approved VEN (sale), the service:
 *   1. Persists the transaction to the DB (pos2013_transactions)
 *   2. Creates a merchant_pos_settlements row (status = 'settled')
 *   3. Credits the merchant wallet via applyOmnibusBackedCredit
 *      (same gate used by the rest of the payment pipeline)
 *
 * This means real NFC captures via PRISMA go through the SAME financial
 * settlement flow as card-not-present transactions — no special casing.
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../../../config/db';
import { getPrismaClient } from './prisma-lapos.client';
import {
  buildVenFields,
  buildAnvFields,
  buildDevFields,
  buildAndFields,
  buildUlcFields,
  buildTarFields,
  buildPlaFields,
  parseVenResponse,
  parseCieResponse,
  parseUltResponse,
  parseTarResponse,
  parsePlaResponse,
  type VenInput,
  type AnvInput,
  type DevInput,
  type AndInput,
  type VenResponse,
  type CieResponse,
  type UltResponse,
  type TarResponse,
  type PlaResponse,
} from './prisma-lapos.protocol';

// ── Merchant context helpers ──────────────────────────────────────────────────
function getMerchantConfig() {
  return {
    merchantId:    process.env.PROCESSOR_MERCHANT_ID  || 'MRC-1001',
    terminalId:    process.env.PROCESSOR_TERMINAL_ID  || 'T2013-001',
    commerceCode:  process.env.PRISMA_COMMERCE_CODE   || process.env.PROCESSOR_MERCHANT_ID || '',
    commerceName:  process.env.PRISMA_COMMERCE_NAME   || process.env.PROCESSOR_NAME       || 'PRIMESTACK',
    commerceTaxId: process.env.PRISMA_COMMERCE_TAX_ID || '',
  };
}

// ── DB helpers ────────────────────────────────────────────────────────────────
async function persistApprovedSale(
  venResp:    VenResponse,
  venInput:   VenInput,
  merchantId: string,
  terminalId: string,
  customerId?: string,
) {
  const txnId   = uuidv4();
  const now     = new Date().toISOString();
  const amount  = venInput.amount;
  const ccy     = 'AED'; // PRISMA Argentina is ARS; adapt currency from env if needed
  const currency = (process.env.PRISMA_CURRENCY || process.env.PROCESSOR_MERCHANT_CURRENCY || ccy).toUpperCase();
  const batchId = `PRISMA-BATCH-${venResp.batchNumber.padStart(6, '0')}`;

  // 1 — pos2013_transactions row
  await db.query(
    `INSERT OR IGNORE INTO pos2013_transactions
      (id, merchant_id, customer_id, terminal_id, batch_id, local_txn_id, stan,
       amount_minor, currency, pan_masked, txn_type, auth_mode, entry_mode,
       auth_code, status, txn_timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PURCHASE', 'online', 'CHIP', ?, 'APPROVED', ?)`,
    [
      txnId,
      merchantId,
      customerId ?? null,
      terminalId,
      batchId,
      venInput.invoiceNumber || txnId,
      venResp.couponNumber,       // coupon doubles as STAN for PRISMA
      Math.round(amount * 100),
      currency,
      venResp.cardFirst6
        ? `${venResp.cardFirst6.slice(0, 6)}******${venResp.cardLast4}`.slice(0, 19)
        : null,
      venResp.authCode,
      now,
    ],
  );

  // 2 — merchant_pos_settlements row
  const settleId = uuidv4();
  const meta = JSON.stringify({
    source:         'prisma_lapos_sale',
    authCode:       venResp.authCode,
    couponNumber:   venResp.couponNumber,
    batchNumber:    venResp.batchNumber,
    cardFirst6:     venResp.cardFirst6,
    cardLast4:      venResp.cardLast4,
    clientName:     venResp.clientName,
    txnDate:        venResp.txnDate,
    txnTime:        venResp.txnTime,
    terminalId:     venResp.terminalId,
    invoiceNumber:  venInput.invoiceNumber,
    installments:   venInput.installments,
    cardCode:       venInput.cardCode,
    planCode:       venInput.planCode,
  });

  await db.query(
    `INSERT OR IGNORE INTO merchant_pos_settlements
      (id, merchant_id, ledger_entry_id, amount, currency, status, settled_at, created_at, meta)
     VALUES (?, ?, ?, ?, ?, 'settled', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)`,
    [settleId, merchantId, txnId, amount, currency, meta],
  );

  // 3 — merchant wallet credit via Omnibus-backed gate
  try {
    const { fundsSettlementService } = await import('../../settlements/funds-settlement.service');
    // settlePOSTransaction requires status='SYNCED'; mark it so
    await db.query(
      `UPDATE pos2013_transactions SET status = 'SYNCED' WHERE id = ?`,
      [txnId],
    );
    await fundsSettlementService.settlePOSTransaction(txnId, 'PRISMA_LAPOS_AUTO');
  } catch (settlementErr: any) {
    // Omnibus shortfall or other settlement error — transaction is recorded
    // but wallet credit is deferred until Omnibus is funded.
    console.warn(
      `[PRISMA] Merchant wallet credit deferred for txn ${txnId}: ${settlementErr.message}`,
    );
  }

  return { txnId, settleId };
}

// ── Service class ─────────────────────────────────────────────────────────────
export class PrismaLaposService {

  // ── Connection test ─────────────────────────────────────────────────────────
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const client = getPrismaClient();
      const ok = await client.test();
      return { ok, message: ok ? 'POS reachable' : 'POS did not acknowledge TES command' };
    } catch (err: any) {
      return { ok: false, message: err.message };
    }
  }

  // ── Sale (VEN) ──────────────────────────────────────────────────────────────
  async sale(input: {
    amount:        number;
    invoiceNumber?: string;
    installments?:  number;
    cardCode?:      string;    // 'VI', 'MC', 'EL', 'VVI' (vending)
    planCode?:      string;
    tipAmount?:     number;
    merchantId?:    string;
    terminalId?:    string;
    customerId?:    string;
    online?:        boolean;
  }): Promise<{ ok: boolean; approved: boolean; txnId?: string; settleId?: string; response: VenResponse; rawFields: string }> {
    const mc    = getMerchantConfig();
    const venIn: VenInput = {
      amount:        input.amount,
      invoiceNumber: input.invoiceNumber || String(Date.now()).slice(-12),
      installments:  input.installments  ?? 1,
      cardCode:      input.cardCode      ?? 'VI',
      planCode:      input.planCode      ?? '0',
      tipAmount:     input.tipAmount     ?? 0,
      commerceCode:  mc.commerceCode,
      commerceName:  mc.commerceName,
      commerceTaxId: mc.commerceTaxId,
      online:        input.online !== false,
    };

    const fields = buildVenFields(venIn);
    const client = getPrismaClient();
    const raw    = await client.send('VEN', fields);
    const resp   = parseVenResponse(raw.fields);

    console.log(
      `[PRISMA] VEN ${resp.approved ? '✅ APPROVED' : '❌ DECLINED'} | ` +
      `RC=${resp.responseCode} | Auth=${resp.authCode} | Coupon=${resp.couponNumber} | ` +
      `${input.amount} | Card=****${resp.cardLast4}`,
    );

    if (resp.approved) {
      const merchantId = input.merchantId || mc.merchantId;
      const terminalId = input.terminalId || mc.terminalId;
      const { txnId, settleId } = await persistApprovedSale(resp, venIn, merchantId, terminalId, input.customerId);
      return { ok: true, approved: true, txnId, settleId, response: resp, rawFields: raw.fields };
    }

    return { ok: false, approved: false, response: resp, rawFields: raw.fields };
  }

  // ── Sale cancellation (ANV) ─────────────────────────────────────────────────
  async cancelSale(input: AnvInput): Promise<{ ok: boolean; approved: boolean; response: VenResponse; rawFields: string }> {
    const fields = buildAnvFields(input);
    const client = getPrismaClient();
    const raw    = await client.send('ANV', fields);
    const resp   = parseVenResponse(raw.fields);

    console.log(
      `[PRISMA] ANV ${resp.approved ? '✅ APPROVED' : '❌ DECLINED'} | ` +
      `RC=${resp.responseCode} | Auth=${resp.authCode} | Coupon=${input.couponNumber}`,
    );

    if (resp.approved) {
      // Mark the original settlement as reversed
      await db.query(
        `UPDATE merchant_pos_settlements
            SET status = 'reversed', meta = json_patch(COALESCE(meta,'{}'), ?)
          WHERE json_extract(meta, '$.couponNumber') = ?`,
        [JSON.stringify({ reversed_by: 'ANV', reversed_at: new Date().toISOString() }), input.couponNumber],
      ).catch(() => { /* non-fatal — coupon may not match if different terminal */ });
    }

    return { ok: resp.approved, approved: resp.approved, response: resp, rawFields: raw.fields };
  }

  // ── Refund / Return (DEV) ───────────────────────────────────────────────────
  async refund(input: DevInput): Promise<{ ok: boolean; approved: boolean; response: VenResponse; rawFields: string }> {
    const mc     = getMerchantConfig();
    const devIn: DevInput = {
      ...input,
      commerceCode:  input.commerceCode  ?? mc.commerceCode,
      commerceName:  input.commerceName  ?? mc.commerceName,
      commerceTaxId: input.commerceTaxId ?? mc.commerceTaxId,
      online:        input.online !== false,
    };
    const fields = buildDevFields(devIn);
    const client = getPrismaClient();
    const raw    = await client.send('DEV', fields);
    const resp   = parseVenResponse(raw.fields);

    console.log(
      `[PRISMA] DEV ${resp.approved ? '✅ APPROVED' : '❌ DECLINED'} | ` +
      `RC=${resp.responseCode} | Auth=${resp.authCode} | OrigCoupon=${input.originalCoupon}`,
    );

    return { ok: resp.approved, approved: resp.approved, response: resp, rawFields: raw.fields };
  }

  // ── Return cancellation (AND) ───────────────────────────────────────────────
  async cancelRefund(input: AndInput): Promise<{ ok: boolean; approved: boolean; response: VenResponse; rawFields: string }> {
    const fields = buildAndFields(input);
    const client = getPrismaClient();
    const raw    = await client.send('AND', fields);
    const resp   = parseVenResponse(raw.fields);

    console.log(
      `[PRISMA] AND ${resp.approved ? '✅ APPROVED' : '❌ DECLINED'} | ` +
      `RC=${resp.responseCode} | Coupon=${input.couponNumber}`,
    );

    return { ok: resp.approved, approved: resp.approved, response: resp, rawFields: raw.fields };
  }

  // ── End-of-day closure (CIE) ────────────────────────────────────────────────
  async close(): Promise<{ ok: boolean; approved: boolean; response: CieResponse; rawFields: string }> {
    const client = getPrismaClient();
    const raw    = await client.send('CIE');
    const resp   = parseCieResponse(raw.fields);

    console.log(
      `[PRISMA] CIE ${resp.approved ? '✅ CLOSED' : '❌ FAILED'} | ` +
      `RC=${resp.responseCode} | Date=${resp.date} | Time=${resp.time}`,
    );

    // Record closure event
    if (resp.approved) {
      await db.query(
        `INSERT OR IGNORE INTO vault_ledger
          (id, ts, type, merchant_id, amount, currency, reference, status, meta)
         VALUES (?, ?, 'PRISMA_BATCH_CLOSE', NULL, 0, 'N/A', ?, 'COMPLETED', ?)`,
        [
          uuidv4(),
          new Date().toISOString(),
          `PRISMA-CIE-${resp.date}-${resp.time}`,
          JSON.stringify({ date: resp.date, time: resp.time, terminalId: resp.terminalId }),
        ],
      ).catch(() => { /* non-fatal */ });
    }

    return { ok: resp.approved, approved: resp.approved, response: resp, rawFields: raw.fields };
  }

  // ── Last transaction (ULT) ──────────────────────────────────────────────────
  async lastTransaction(): Promise<{ ok: boolean; response: UltResponse; rawFields: string }> {
    const client = getPrismaClient();
    const raw    = await client.send('ULT');
    const resp   = parseUltResponse(raw.fields);
    return { ok: resp.approved, response: resp, rawFields: raw.fields };
  }

  // ── Last closure (ULC) ──────────────────────────────────────────────────────
  async lastClose(index = 0): Promise<{ ok: boolean; rawFields: string; parsed: Record<string, string> }> {
    const fields = buildUlcFields(index);
    const client = getPrismaClient();
    const raw    = await client.send('ULC', fields);
    // Parse flat field layout per spec
    const f = raw.fields;
    const parsed: Record<string, string> = {
      recordIndex:           f.slice(0, 4).trim(),
      processorCode:         f.slice(4, 7).trim(),
      batchNumber:           f.slice(7, 10).trim(),
      cardCode:              f.slice(10, 13).trim(),
      salesCount:            f.slice(13, 17).trim(),
      salesTotal:            f.slice(17, 29).trim(),
      cancelSalesCount:      f.slice(29, 33).trim(),
      cancelSalesTotal:      f.slice(33, 45).trim(),
      returnSalesCount:      f.slice(45, 49).trim(),
      returnSalesTotal:      f.slice(49, 61).trim(),
      cancelReturnCount:     f.slice(61, 65).trim(),
      cancelReturnTotal:     f.slice(65, 77).trim(),
      closeDate:             f.slice(77, 87).trim(),
      closeTime:             f.slice(87, 95).trim(),
      terminalId:            f.slice(95).trim(),
    };
    return { ok: raw.approved, rawFields: raw.fields, parsed };
  }

  // ── Reprint last transaction (IMT) ──────────────────────────────────────────
  async reprintLastTransaction(): Promise<{ ok: boolean; message: string }> {
    const client = getPrismaClient();
    const raw    = await client.send('IMT');
    return { ok: raw.approved, message: raw.message };
  }

  // ── Reprint last closure (IMC) ──────────────────────────────────────────────
  async reprintLastClose(): Promise<{ ok: boolean; message: string }> {
    const client = getPrismaClient();
    const raw    = await client.send('IMC');
    return { ok: raw.approved, message: raw.message };
  }

  // ── Card table (TAR) — fetch all, paginating until hasMore = false ──────────
  async cardTable(): Promise<{ ok: boolean; cards: TarResponse[] }> {
    const cards: TarResponse[] = [];
    const client = getPrismaClient();
    let index = 0;
    while (true) {
      const fields = buildTarFields(index);
      const raw    = await client.send('TAR', fields);
      const card   = parseTarResponse(raw.fields, raw.responseCode);
      cards.push(card);
      if (!card.hasMore) break;
      index++;
      if (index > 50) break; // safety cap
    }
    return { ok: true, cards };
  }

  // ── Plan table (PLA) — fetch all, paginating until hasMore = false ──────────
  async planTable(): Promise<{ ok: boolean; plans: PlaResponse[] }> {
    const plans: PlaResponse[] = [];
    const client = getPrismaClient();
    let index = 0;
    while (true) {
      const fields = buildPlaFields(index);
      const raw    = await client.send('PLA', fields);
      const plan   = parsePlaResponse(raw.fields, raw.responseCode);
      plans.push(plan);
      if (!plan.hasMore) break;
      index++;
      if (index > 100) break; // safety cap
    }
    return { ok: true, plans };
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────
export const prismaLaposService = new PrismaLaposService();
