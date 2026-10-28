/**
 * WISE WEBHOOK SERVICE
 * ─────────────────────────────────────────────────────────────────────────────
 * B: Handles outbound payout status updates from Wise
 *    transfer.funds_received  → mark merchant payout PROCESSING
 *    transfer.completed       → mark merchant payout COMPLETED
 *    transfer.failed          → mark FAILED, refund merchant wallet
 *
 * D: Handles INCOMING transfers from Wise
 *    incoming-transfer#credited  → credit merchant wallet (funds received from card issuer)
 *    balance#credit              → credit merchant wallet
 *
 * Wise webhook docs: https://docs.wise.com/api-docs/features/webhooks-notifications
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';

// ── Signature verification ────────────────────────────────────────────────────
export function verifyWiseWebhook(rawBody: Buffer | string, signatureHeader?: string): boolean {
  const secret = process.env.WISE_WEBHOOK_SECRET?.trim();

  // If no secret configured — allow through (dev mode) but log warning
  if (!secret) {
    console.warn('[WiseWebhook] WISE_WEBHOOK_SECRET not set — skipping signature check');
    return true;
  }

  if (!signatureHeader) {
    console.warn('[WiseWebhook] Missing signature header');
    return false;
  }

  const payload  = rawBody instanceof Buffer ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const provided = signatureHeader.trim().replace(/^sha256=/, '');

  try {
    const providedBuf = Buffer.from(provided, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (providedBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}

// ── Main webhook handler ──────────────────────────────────────────────────────
export async function handleWiseWebhook(event: any): Promise<any> {
  if (!event || !event.event_type) {
    // Some Wise events use "type" instead of "event_type"
    event = { ...event, event_type: event?.type || event?.eventType || 'unknown' };
  }

  const eventType = String(event.event_type || event.type || '').toLowerCase();
  console.log(`[WiseWebhook] Received event: ${eventType}`);

  // ── D: Incoming transfer — funds arriving from card issuer via Wise ──────────
  if (
    eventType.includes('incoming-transfer') ||
    eventType.includes('incoming_transfer') ||
    eventType.includes('balance#credit') ||
    eventType.includes('balance.credit') ||
    eventType === 'transfers#state-change' ||
    eventType.includes('credited')
  ) {
    return handleIncomingTransfer(event);
  }

  // ── B: Outbound transfer status updates ─────────────────────────────────────
  if (
    eventType.includes('transfer') ||
    eventType.includes('outgoing')
  ) {
    return handleOutboundTransfer(event);
  }

  console.log(`[WiseWebhook] Unhandled event type: ${eventType}`);
  return { success: true, status: 'IGNORED', eventType };
}

// ── D: Incoming transfer — credit merchant wallet ─────────────────────────────
async function handleIncomingTransfer(event: any): Promise<any> {
  const data      = event.data || event.resource || event;
  const amount    = Number(data?.amount || data?.value || data?.sourceAmount || data?.targetAmount || 0);
  const currency  = String(data?.currency || data?.sourceCurrency || data?.targetCurrency || 'USD').toUpperCase();
  const reference = String(data?.reference || data?.details?.reference || event.subscription_id || data?.id || '');
  const transferId = String(data?.id || data?.transferId || data?.transfer_id || '');

  if (!amount || amount <= 0) {
    return { success: false, status: 'IGNORED', reason: 'Amount is zero or missing' };
  }

  console.log(`[WiseWebhook] ▲ Incoming transfer: ${currency} ${amount} | Ref: ${reference} | Transfer: ${transferId}`);

  // Try to match to a merchant from reference
  const merchantId = await resolveMerchantFromReference(reference) || 'MRC-1001';

  try {
    // Credit merchant wallet
    const wallet = await getOrCreateMerchantWalletRow(merchantId, currency);

    await db.query(
      'UPDATE merchant_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [amount, wallet.id]
    );

    // Record the credit transaction
    await db.query(
      `INSERT INTO merchant_wallet_transactions
         (id, wallet_id, type, amount, currency, source, reference, description, created_at)
       VALUES (?, ?, 'credit', ?, ?, 'wise_incoming', ?, ?, CURRENT_TIMESTAMP)`,
      [
        uuidv4(),
        wallet.id,
        amount,
        currency,
        transferId || reference,
        `Wise incoming transfer — ${currency} ${amount}${reference ? ` (ref: ${reference})` : ''}`,
      ]
    );

    // Record in ledger
    await db.query(
      `INSERT OR IGNORE INTO ledger_entries
         (id, transaction_id, type, amount, currency, status, description, merchant_id, created_at)
       VALUES (?, ?, 'credit', ?, ?, 'SETTLED', ?, ?, CURRENT_TIMESTAMP)`,
      [
        uuidv4(),
        transferId || uuidv4(),
        amount,
        currency,
        `Wise incoming: ${currency} ${amount} from card issuer settlement`,
        merchantId,
      ]
    );

    // Store raw webhook event for audit
    await storeWebhookEvent(event, 'incoming_transfer_credited', merchantId);

    console.log(`[WiseWebhook] ✅ Merchant ${merchantId} credited ${currency} ${amount}`);
    return {
      success: true,
      status: 'CREDITED',
      merchantId,
      amount,
      currency,
      transferId,
      reference,
    };
  } catch (err: any) {
    console.error('[WiseWebhook] Failed to credit merchant wallet:', err.message);
    throw err;
  }
}

// ── B: Outbound transfer status update ────────────────────────────────────────
async function handleOutboundTransfer(event: any): Promise<any> {
  const data       = event.data || event.resource || event;
  const transferId = String(data?.id || data?.transferId || data?.transfer_id || '');
  const newStatus  = String(data?.status || event.current_state || '').toUpperCase();

  if (!transferId) {
    return { success: false, status: 'IGNORED', reason: 'No transfer ID in event' };
  }

  console.log(`[WiseWebhook] ◆ Outbound transfer ${transferId} → ${newStatus}`);

  // Find matching merchant payout
  const payoutRes = await db.query(
    `SELECT id, merchant_id, amount, currency FROM merchant_payouts
     WHERE provider_reference = ? OR provider_reference LIKE ?
     LIMIT 1`,
    [transferId, `%${transferId}%`]
  );

  if (!payoutRes.rows.length) {
    console.warn(`[WiseWebhook] No payout found for transfer ${transferId}`);
    await storeWebhookEvent(event, 'unmatched_outbound', null);
    return { success: true, status: 'IGNORED', reason: 'No matching payout found', transferId };
  }

  const payout = payoutRes.rows[0];

  if (newStatus.includes('COMPLETED') || newStatus.includes('OUTGOING_PAYMENT_SENT') || newStatus.includes('FUNDS_CONVERTED')) {
    await db.query(
      `UPDATE merchant_payouts SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [payout.id]
    );
    await storeWebhookEvent(event, 'outbound_completed', payout.merchant_id);
    console.log(`[WiseWebhook] ✅ Payout ${payout.id} marked COMPLETED`);
    return { success: true, status: 'COMPLETED', payoutId: payout.id };
  }

  if (newStatus.includes('PROCESSING') || newStatus.includes('FUNDS_RECEIVED')) {
    await db.query(
      `UPDATE merchant_payouts SET status = 'PROCESSING', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [payout.id]
    );
    await storeWebhookEvent(event, 'outbound_processing', payout.merchant_id);
    return { success: true, status: 'PROCESSING', payoutId: payout.id };
  }

  if (newStatus.includes('FAILED') || newStatus.includes('CANCELLED') || newStatus.includes('BOUNCED')) {
    // Refund merchant wallet
    try {
      await db.query('BEGIN IMMEDIATE');
      const wallet = await getOrCreateMerchantWalletRow(payout.merchant_id, payout.currency || 'USD');

      await db.query(
        'UPDATE merchant_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [Number(payout.amount), wallet.id]
      );
      await db.query(
        `INSERT INTO merchant_wallet_transactions
           (id, wallet_id, type, amount, currency, source, reference, description, created_at)
         VALUES (?, ?, 'credit', ?, ?, 'wise_payout_refund', ?, ?, CURRENT_TIMESTAMP)`,
        [
          uuidv4(), wallet.id,
          Number(payout.amount), payout.currency || 'USD',
          transferId,
          `Refund — Wise transfer ${transferId} ${newStatus}`,
        ]
      );
      await db.query(
        `UPDATE merchant_payouts SET status = 'FAILED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [payout.id]
      );
      await db.query('COMMIT');
    } catch (err) {
      try { await db.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    }

    await storeWebhookEvent(event, 'outbound_failed_refunded', payout.merchant_id);
    console.log(`[WiseWebhook] ⚠️ Payout ${payout.id} FAILED — merchant wallet refunded ${payout.amount}`);
    return { success: true, status: 'FAILED_REFUNDED', payoutId: payout.id, refunded: payout.amount };
  }

  // Unknown status — store and ignore
  await storeWebhookEvent(event, `outbound_${newStatus.toLowerCase()}`, payout.merchant_id);
  return { success: true, status: 'RECORDED', newStatus, payoutId: payout.id };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getOrCreateMerchantWalletRow(merchantId: string, currency: string) {
  const cur = (currency || 'USD').toUpperCase();
  const existing = await db.query(
    'SELECT id, balance FROM merchant_wallets WHERE merchant_id = ? AND currency = ? LIMIT 1',
    [merchantId, cur]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  // Create if not exists
  const newId = uuidv4();
  await db.query(
    `INSERT INTO merchant_wallets (id, merchant_id, balance, currency, created_at, updated_at)
     VALUES (?, ?, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [newId, merchantId, cur]
  );
  return { id: newId, balance: 0 };
}

async function resolveMerchantFromReference(reference: string): Promise<string | null> {
  if (!reference) return null;
  try {
    // Try to match reference to a known payout
    const res = await db.query(
      `SELECT merchant_id FROM merchant_payouts WHERE id LIKE ? OR provider_reference LIKE ? LIMIT 1`,
      [`%${reference.slice(0, 12)}%`, `%${reference.slice(0, 12)}%`]
    );
    if (res.rows.length > 0) return res.rows[0].merchant_id;
  } catch { /* ignore */ }
  return null;
}

async function storeWebhookEvent(event: any, eventCategory: string, merchantId: string | null) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS wise_webhook_events (
        id TEXT PRIMARY KEY,
        event_type TEXT,
        event_category TEXT,
        merchant_id TEXT,
        raw_payload TEXT,
        created_at TEXT
      )
    `);
    await db.query(
      `INSERT INTO wise_webhook_events (id, event_type, event_category, merchant_id, raw_payload, created_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        uuidv4(),
        event.event_type || event.type || 'unknown',
        eventCategory,
        merchantId,
        JSON.stringify(event).slice(0, 8000),
      ]
    );
  } catch { /* non-critical — ignore */ }
}
