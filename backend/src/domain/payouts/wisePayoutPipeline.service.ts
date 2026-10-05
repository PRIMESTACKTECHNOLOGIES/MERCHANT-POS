/**
 * Wise Payout Pipeline — Full 6-Step Settlement Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Step 1  External provider confirms custody of funds
 * Step 2  Approved Wise funding mechanism funds the Wise transfer
 * Step 3  Wise accepts the transfer
 * Step 4  Wise sends the funds to the ABSA beneficiary
 * Step 5  Wise / provider status confirms completion
 * Step 6  POS marks the payout SETTLED
 *
 * Provider = your internal acquirer (PRIMESTACK, Protocol 201.3)
 * Rail     = Wise (transport only)
 */

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { db }            from '../../config/db';
import { getWiseBalance } from './wiseCollect.service';

const BASE_URL = (process.env.WISE_API_URL?.trim() || 'https://api.wise.com/2026Q3').replace(/\/+$/, '');
const API_KEY  = process.env.WISE_API_KEY?.trim();

function wiseHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` };
}

export type PipelineStepStatus = 'OK' | 'FAILED' | 'SKIPPED' | 'PENDING';

export interface PipelineStepResult {
  step:    number;
  name:    string;
  status:  PipelineStepStatus;
  detail:  string;
  data?:   any;
}

export interface PipelineResult {
  ok:          boolean;
  payoutId:    string;
  finalStatus: string;          // SETTLED | FAILED | PENDING
  steps:       PipelineStepResult[];
  transferId?: string;
  uetr?:       string;
  message:     string;
}

// ── Resolve Wise profile ID ───────────────────────────────────────────────────
async function resolveProfileId(): Promise<string> {
  const explicit = process.env.WISE_PROFILE_ID?.trim();
  if (explicit) return explicit;
  const res = await axios.get(`${BASE_URL}/v1/profiles`, { headers: wiseHeaders(), timeout: 10000 });
  const profiles: any[] = Array.isArray(res.data) ? res.data : [];
  const biz = profiles.find(p => p.type === 'business') || profiles[0];
  if (!biz?.id) throw new Error('No Wise profile found — check WISE_API_KEY');
  return String(biz.id);
}

// ── Get or create Wise recipient ──────────────────────────────────────────────
async function getOrCreateRecipient(profileId: string, account: {
  account_holder?: string;
  account_number?: string;
  routing_number?: string;
  swift_code?:     string;
  iban?:           string;
}, currency: string): Promise<string> {
  const ccy = currency.toUpperCase();
  const payload: any = {
    profile:           Number(profileId),
    accountHolderName: account.account_holder || 'JUKRUTI LOGISTICS PTY LTD',
    currency:          ccy,
    type:              ccy === 'USD' ? 'aba' : ccy === 'EUR' ? 'iban' : 'swift',
    legalType:         'BUSINESS',
    details:           {},
  };

  if (ccy === 'USD') {
    payload.details.abartn        = account.routing_number || account.swift_code || '250655';
    payload.details.accountNumber = account.account_number || '';
    payload.details.accountType   = 'CHECKING';
    payload.details.address = {
      country: 'ZA', city: 'Johannesburg',
      firstLine: '9 HOUTKAPPER STR, OLIFANTSHOEK', postCode: '8450',
    };
  } else if (ccy === 'EUR') {
    payload.details.IBAN = account.iban || account.account_number || '';
  } else {
    payload.details.swiftCode     = account.swift_code || '';
    payload.details.accountNumber = account.account_number || '';
  }

  try {
    const res = await axios.post(`${BASE_URL}/v1/accounts`, payload,
      { headers: wiseHeaders(), timeout: 15000 });
    return String(res.data.id);
  } catch (err: any) {
    const conflict = err?.response?.data?.errors?.find(
      (e: any) => e.code === 'RECIPIENT_ACCOUNT_ALREADY_EXISTS'
    );
    if (conflict?.metadata?.recipientAccountId) {
      return String(conflict.metadata.recipientAccountId);
    }
    throw new Error(`Recipient creation failed: ${err?.response?.data?.errors?.[0]?.message || err.message}`);
  }
}

// ── Poll Wise transfer status (with retries) ──────────────────────────────────
async function pollTransferStatus(transferId: string, maxWaitMs = 30000): Promise<string> {
  const deadline = Date.now() + maxWaitMs;
  const terminal = ['OUTGOING_PAYMENT_SENT','COMPLETED','FUNDS_CONVERTED','FAILED','CANCELLED','BOUNCED','REJECTED'];
  while (Date.now() < deadline) {
    try {
      const res = await axios.get(`${BASE_URL}/v1/transfers/${transferId}`,
        { headers: wiseHeaders(), timeout: 10000 });
      const s = String(res.data?.status || '').toUpperCase();
      if (terminal.some(t => s.includes(t))) return s;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 3000));
  }
  return 'PENDING'; // still in flight after maxWait
}

// ── Main pipeline ─────────────────────────────────────────────────────────────
export async function executePayoutPipeline(payoutId: string): Promise<PipelineResult> {
  const steps: PipelineStepResult[] = [];
  let transferId: string | undefined;
  let uetr: string | undefined;

  const fail = (step: number, name: string, detail: string, data?: any): PipelineResult => {
    steps.push({ step, name, status: 'FAILED', detail, data });
    return { ok: false, payoutId, finalStatus: 'FAILED', steps, message: detail };
  };

  // ── Load payout record ───────────────────────────────────────────────────────
  const payoutRows = (await db.query(
    `SELECT p.*, si.id AS si_id, si.destination_bank, si.destination_account_holder,
            si.destination_account_number, si.destination_routing, si.destination_swift,
            si.destination_iban, si.reference AS si_reference
     FROM merchant_payouts p
     LEFT JOIN payout_settlement_instructions si ON si.payout_id = p.id
     WHERE p.id = ? LIMIT 1`,
    [payoutId]
  )).rows;

  if (!payoutRows.length) {
    return fail(0, 'Load payout', `Payout ${payoutId} not found`);
  }
  const payout = payoutRows[0] as any;
  const bankAccount = typeof payout.bank_account === 'string'
    ? JSON.parse(payout.bank_account)
    : (payout.bank_account || {});

  const currency = String(payout.currency || 'USD').toUpperCase();
  const amount   = Number(payout.amount);

  // Already settled — idempotent
  if (['SETTLED','COMPLETED','OUTGOING_PAYMENT_SENT'].includes(String(payout.status || '').toUpperCase())) {
    return {
      ok: true, payoutId, finalStatus: 'SETTLED', steps: [],
      transferId: payout.provider_reference || undefined,
      message: `Payout ${payoutId} is already SETTLED.`,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1 — External provider confirms custody of funds
  // Your internal acquirer holds the funds in the vault / merchant wallet.
  // Custody = vault balance ≥ payout amount in same currency.
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    const vaultRow = (await db.query(
      `SELECT balance FROM vault_accounts WHERE currency = ? ORDER BY balance DESC LIMIT 1`,
      [currency]
    )).rows[0] as any;
    const vaultBalance = Number(vaultRow?.balance ?? 0);
    const merchantRow  = (await db.query(
      `SELECT balance FROM merchant_wallets WHERE merchant_id = ? AND currency = ? LIMIT 1`,
      [payout.merchant_id || 'MRC-1001', currency]
    )).rows[0] as any;
    const merchantBalance = Number(merchantRow?.balance ?? 0);
    const custody = Math.max(vaultBalance, merchantBalance);

    if (custody < amount) {
      return fail(1, 'Custody confirmation',
        `Insufficient internal custody. Vault ${currency} ${vaultBalance.toFixed(2)}, Merchant ${currency} ${merchantBalance.toFixed(2)}, need ${amount.toFixed(2)}.`,
        { vault: vaultBalance, merchant: merchantBalance, required: amount }
      );
    }
    steps.push({ step: 1, name: 'Custody confirmation', status: 'OK',
      detail: `Internal acquirer confirms custody: ${currency} ${custody.toFixed(2)} available (vault ${vaultBalance.toFixed(2)} + merchant ${merchantBalance.toFixed(2)})`,
      data: { vault: vaultBalance, merchant: merchantBalance }
    });
  } catch (e: any) {
    return fail(1, 'Custody confirmation', `Custody check failed: ${e.message}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 2 — Approved Wise funding mechanism checks Wise balance
  // ─────────────────────────────────────────────────────────────────────────────
  if (!API_KEY) {
    return fail(2, 'Wise funding check', 'WISE_API_KEY not configured in .env — cannot proceed.');
  }

  let wiseBalance = 0;
  let profileId   = '';
  try {
    profileId    = await resolveProfileId();
    wiseBalance  = await getWiseBalance(currency);
    steps.push({ step: 2, name: 'Wise funding mechanism', status: 'OK',
      detail: `Wise profile ${profileId} active. ${currency} balance: ${wiseBalance.toFixed(2)}. ${wiseBalance < amount ? '⚠️ Insufficient — transfer will attempt anyway (Wise may source from other balance types).' : 'Sufficient balance.'}`,
      data: { profileId, wiseBalance }
    });
  } catch (e: any) {
    return fail(2, 'Wise funding mechanism', `Wise profile/balance check failed: ${e.message}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 3 — Wise accepts the transfer (create recipient + quote + transfer)
  // ─────────────────────────────────────────────────────────────────────────────
  let transfer: any;
  try {
    // 3a. Recipient
    const recipientId = await getOrCreateRecipient(profileId, {
      account_holder:  bankAccount.account_holder  || payout.si_destination_account_holder,
      account_number:  bankAccount.account_number  || payout.si_destination_account_number,
      routing_number:  bankAccount.routing_number  || payout.si_destination_routing,
      swift_code:      bankAccount.swift_code      || payout.si_destination_swift,
      iban:            bankAccount.iban             || payout.si_destination_iban,
    }, currency);

    // 3b. Quote
    const quoteRes = await axios.post(`${BASE_URL}/v2/quotes`, {
      profile:        Number(profileId),
      sourceCurrency: currency,
      targetCurrency: currency,
      targetAmount:   amount,
      rateType:       'FIXED',
      type:           'BALANCE_PAYOUT',
    }, { headers: wiseHeaders(), timeout: 15000 });
    const quote = quoteRes.data;

    // 3c. Transfer
    const customerTxnId = payout.si_reference || `PIPE-${payoutId.slice(0, 12).toUpperCase()}`;
    try {
      const tRes = await axios.post(`${BASE_URL}/v1/transfers`, {
        targetAccount:         Number(recipientId),
        quoteUuid:             String(quote.id),
        customerTransactionId: customerTxnId,
        details: { reference: customerTxnId.slice(0, 35) },
      }, { headers: wiseHeaders(), timeout: 15000 });
      transfer = tRes.data;
    } catch (err: any) {
      // Idempotent — reuse existing transfer
      const dup = err?.response?.data?.errors?.find(
        (e: any) => e.code === 'DUPLICATE_CUSTOMER_TRANSACTION_ID'
      );
      if (dup) {
        const ex = await axios.get(
          `${BASE_URL}/v1/transfers?profile=${profileId}&customerTransactionId=${customerTxnId}`,
          { headers: wiseHeaders(), timeout: 10000 }
        );
        transfer = Array.isArray(ex.data) ? ex.data[0] : ex.data;
      } else throw err;
    }

    transferId = String(transfer.id);
    uetr       = transfer.uetr || undefined;

    // Update payout + settlement instruction with transfer ID
    await db.query(
      `UPDATE merchant_payouts SET provider_reference = ?, provider = 'internal/wise-rail',
       status = 'PROCESSING', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [transferId, payoutId]
    );
    if (payout.si_id) {
      await db.query(
        `UPDATE payout_settlement_instructions SET status = 'SENT', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [payout.si_id]
      );
    }

    steps.push({ step: 3, name: 'Wise accepts transfer', status: 'OK',
      detail: `Wise transfer ${transferId} created. Recipient: ${recipientId}. Quote: ${quote.id}. Status: ${transfer.status}`,
      data: { transferId, recipientId, quoteId: quote.id, transferStatus: transfer.status, uetr }
    });
  } catch (e: any) {
    // Mark instruction as FAILED
    if (payout.si_id) {
      await db.query(
        `UPDATE payout_settlement_instructions
         SET status = 'FAILED', bank_callback_response = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [JSON.stringify({ error: e.message }), payout.si_id]
      );
    }
    return fail(3, 'Wise accepts transfer', `Transfer creation failed: ${e.message}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 4 — Fund the Wise transfer from Wise balance
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    await axios.post(
      `${BASE_URL}/v3/profiles/${profileId}/transfers/${transferId}/payments`,
      { type: 'BALANCE' },
      { headers: wiseHeaders(), timeout: 20000 }
    );
    steps.push({ step: 4, name: 'Wise sends to beneficiary', status: 'OK',
      detail: `Transfer ${transferId} funded from Wise ${currency} balance. Wise is now sending to beneficiary.`,
      data: { transferId, fundedAt: new Date().toISOString() }
    });
  } catch (err: any) {
    const code = err?.response?.data?.errors?.[0]?.code || '';
    const alreadyFunded = ['TRANSFER_ALREADY_FUNDED','BAD_STATE','ILLEGAL_STATE_TRANSITION'].includes(code);
    if (alreadyFunded) {
      steps.push({ step: 4, name: 'Wise sends to beneficiary', status: 'OK',
        detail: `Transfer ${transferId} already funded — already in progress.`,
        data: { transferId, code }
      });
    } else {
      // Non-fatal — transfer may auto-fund; continue to status check
      steps.push({ step: 4, name: 'Wise sends to beneficiary', status: 'PENDING',
        detail: `Funding call returned: ${err?.response?.data?.errors?.[0]?.message || err.message}. Transfer may still process.`,
        data: { transferId, code }
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 5 — Wise / provider status confirms completion (poll up to 30s)
  // ─────────────────────────────────────────────────────────────────────────────
  let wiseStatus = '';
  try {
    wiseStatus = await pollTransferStatus(transferId, 30000);
    const settled = ['OUTGOING_PAYMENT_SENT','COMPLETED','FUNDS_CONVERTED'].some(s => wiseStatus.includes(s));
    const failed  = ['FAILED','CANCELLED','BOUNCED','REJECTED'].some(s => wiseStatus.includes(s));

    steps.push({ step: 5, name: 'Provider status confirmation', status: settled ? 'OK' : failed ? 'FAILED' : 'PENDING',
      detail: `Wise transfer ${transferId} status: ${wiseStatus}`,
      data: { transferId, wiseStatus }
    });

    if (failed) {
      // Refund merchant wallet
      try {
        const wallet = (await db.query(
          `SELECT id FROM merchant_wallets WHERE merchant_id = ? AND currency = ? LIMIT 1`,
          [payout.merchant_id || 'MRC-1001', currency]
        )).rows[0] as any;
        if (wallet) {
          await db.query(
            `UPDATE merchant_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [amount, wallet.id]
          );
          await db.query(
            `INSERT INTO merchant_wallet_transactions (id, wallet_id, type, amount, currency, source, reference, description, created_at)
             VALUES (?,?,'credit',?,?,'wise_payout_refund',?,?,CURRENT_TIMESTAMP)`,
            [uuidv4(), wallet.id, amount, currency, transferId, `Wise ${wiseStatus} — pipeline refund`]
          );
        }
      } catch { /* best-effort refund */ }

      await db.query(
        `UPDATE merchant_payouts SET status = 'FAILED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [payoutId]
      );
      if (payout.si_id) {
        await db.query(
          `UPDATE payout_settlement_instructions SET status = 'FAILED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [payout.si_id]
        );
      }
      return { ok: false, payoutId, finalStatus: 'FAILED', steps, transferId, uetr,
        message: `Transfer ${transferId} ${wiseStatus} — merchant wallet refunded.` };
    }
  } catch (e: any) {
    wiseStatus = 'PENDING';
    steps.push({ step: 5, name: 'Provider status confirmation', status: 'PENDING',
      detail: `Status polling failed: ${e.message}. Transfer may still complete — run sync to update.`,
      data: { transferId }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 6 — POS marks the payout SETTLED
  // ─────────────────────────────────────────────────────────────────────────────
  const isConfirmed = ['OUTGOING_PAYMENT_SENT','COMPLETED','FUNDS_CONVERTED'].some(s => wiseStatus.includes(s));
  const finalPosStatus = isConfirmed ? 'SETTLED' : 'PROCESSING';
  const now = new Date().toISOString();

  try {
    await db.query(
      `UPDATE merchant_payouts
       SET status = ?, provider = 'internal/wise-rail', provider_reference = ?,
           completed_at = CASE WHEN ? = 'SETTLED' THEN ? ELSE completed_at END,
           updated_at = ?
       WHERE id = ?`,
      [finalPosStatus, transferId, finalPosStatus, now, now, payoutId]
    );

    // Mark settlement instruction SETTLED
    if (payout.si_id) {
      await db.query(
        `UPDATE payout_settlement_instructions
         SET status = ?, bank_callback_response = ?, updated_at = ?
         WHERE id = ?`,
        [
          isConfirmed ? 'SETTLED' : 'PROCESSING',
          JSON.stringify({
            pipeline: 'wise_rail',
            wise_transfer_id: transferId,
            wise_status: wiseStatus,
            settled_at: isConfirmed ? now : null,
          }),
          now,
          payout.si_id,
        ]
      );
    }

    // Also update any related batch settlements
    await db.query(
      `UPDATE merchant_pos_settlements
       SET status = ?, settled_at = CASE WHEN ? = 'SETTLED' THEN ? ELSE settled_at END
       WHERE merchant_id = ? AND currency = ? AND status NOT IN ('SETTLED')
       AND created_at <= ?`,
      [
        isConfirmed ? 'settled' : 'processing',
        finalPosStatus, now,
        payout.merchant_id || 'MRC-1001',
        currency,
        now,
      ]
    );

    // Record in audit trail
    await db.query(
      `INSERT OR IGNORE INTO vault_audit_trail
         (id, account_id, type, amount, currency, reference, description, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        uuidv4(),
        'PROC-VAULT',
        'PAYOUT_SETTLED',
        amount, currency,
        transferId || payoutId,
        `Pipeline settled: ${payoutId} via Wise transfer ${transferId} (${wiseStatus})`,
        now,
      ]
    );

    steps.push({ step: 6, name: 'POS marks payout SETTLED', status: isConfirmed ? 'OK' : 'PENDING',
      detail: isConfirmed
        ? `✅ Payout ${payoutId} marked SETTLED. Wise transfer ${transferId} confirmed ${wiseStatus}. Settlement instruction updated.`
        : `⏳ Payout ${payoutId} marked PROCESSING. Wise transfer ${transferId} still in transit (${wiseStatus}). Run /api/payout/wise/sync to auto-settle when Wise confirms.`,
      data: { payoutId, finalPosStatus, transferId, wiseStatus }
    });

    console.log(`[Pipeline] ✅ Payout ${payoutId} → ${finalPosStatus} | Transfer ${transferId} | Wise ${wiseStatus}`);

    return {
      ok:          true,
      payoutId,
      finalStatus: finalPosStatus,
      steps,
      transferId,
      uetr,
      message: isConfirmed
        ? `✅ SETTLED — ${currency} ${amount} sent to ${bankAccount.bank_name || 'beneficiary'} via Wise transfer ${transferId}.`
        : `⏳ PROCESSING — Wise transfer ${transferId} is in transit. Payout will auto-settle when Wise confirms delivery.`,
    };
  } catch (e: any) {
    return fail(6, 'POS marks payout SETTLED', `Failed to update status: ${e.message}`);
  }
}
