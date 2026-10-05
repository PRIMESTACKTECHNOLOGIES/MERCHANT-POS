/**
 * INTERNAL PAYOUT PROVIDER
 * ─────────────────────────────────────────────────────────────────────────────
 * This is YOUR OWN licensed acquirer payout processor.
 * No external gateway. No third-party API. Fully self-hosted.
 *
 * When BANK_PAYOUT_PROVIDER=internal:
 *   1. Merchant wallet is debited (already done by bank.router.ts before calling here)
 *   2. This provider generates a settlement instruction record
 *   3. The internal acquirer remains the source-of-funds and accounting owner
 *   4. The settlement record is stored in payout_settlement_instructions table
 *      for your bank to pick up (file-based, API-based, or manual wire)
 *
 * To connect your bank:
 *   - Set INTERNAL_PAYOUT_BANK_CALLBACK_URL to your bank's receiving endpoint
 *   - OR leave blank — the settlement instruction is stored and you download it
 */

import { db } from '../../config/db';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

export interface InternalPayoutRequest {
  merchantId: string;
  payoutId: string;
  amount: number;
  currency: string;
  bankAccount: {
    bank_name?: string;
    account_holder?: string;
    account_number?: string;
    routing_number?: string;
    swift_code?: string;
    iban?: string;
    account_type?: string;
  };
  reference?: string;
}

export interface InternalPayoutResult {
  success: boolean;
  provider: string;
  providerReference: string;
  status: string;
  settlementInstructionId: string;
  raw?: any;
}

export async function executeInternalPayout(req: InternalPayoutRequest): Promise<InternalPayoutResult> {
  const now = new Date().toISOString();
  const settlementRef = `INTL-${req.merchantId}-${Date.now().toString(36).toUpperCase()}`;
  const instructionId = uuidv4();

  // Build settlement instruction
  const instruction = {
    id: instructionId,
    payout_id: req.payoutId,
    merchant_id: req.merchantId,
    reference: settlementRef,
    amount: req.amount,
    currency: req.currency,
    destination_bank: req.bankAccount.bank_name || '',
    destination_account_holder: req.bankAccount.account_holder || '',
    destination_account_number: req.bankAccount.account_number || '',
    destination_routing: req.bankAccount.routing_number || '',
    destination_swift: req.bankAccount.swift_code || '',
    destination_iban: req.bankAccount.iban || '',
    destination_account_type: req.bankAccount.account_type || 'CHECKING',
    status: 'PENDING',
    created_at: now,
    updated_at: now,
  };

  // Store settlement instruction
  try {
    await db.query(`
      INSERT OR IGNORE INTO payout_settlement_instructions
        (id, payout_id, merchant_id, reference, amount, currency,
         destination_bank, destination_account_holder, destination_account_number,
         destination_routing, destination_swift, destination_iban,
         destination_account_type, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      instruction.id, instruction.payout_id, instruction.merchant_id,
      instruction.reference, instruction.amount, instruction.currency,
      instruction.destination_bank, instruction.destination_account_holder,
      instruction.destination_account_number, instruction.destination_routing,
      instruction.destination_swift, instruction.destination_iban,
      instruction.destination_account_type, instruction.status,
      instruction.created_at, instruction.updated_at,
    ]);
  } catch (e: any) {
    // Table may not exist yet — create it
    if (String(e?.message).includes('no such table')) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS payout_settlement_instructions (
          id TEXT PRIMARY KEY,
          payout_id TEXT NOT NULL,
          merchant_id TEXT NOT NULL,
          reference TEXT NOT NULL,
          amount REAL NOT NULL,
          currency TEXT NOT NULL DEFAULT 'USD',
          destination_bank TEXT,
          destination_account_holder TEXT,
          destination_account_number TEXT,
          destination_routing TEXT,
          destination_swift TEXT,
          destination_iban TEXT,
          destination_account_type TEXT DEFAULT 'CHECKING',
          status TEXT NOT NULL DEFAULT 'PENDING',
          bank_callback_response TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      await db.query(`
        INSERT INTO payout_settlement_instructions
          (id, payout_id, merchant_id, reference, amount, currency,
           destination_bank, destination_account_holder, destination_account_number,
           destination_routing, destination_swift, destination_iban,
           destination_account_type, status, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        instruction.id, instruction.payout_id, instruction.merchant_id,
        instruction.reference, instruction.amount, instruction.currency,
        instruction.destination_bank, instruction.destination_account_holder,
        instruction.destination_account_number, instruction.destination_routing,
        instruction.destination_swift, instruction.destination_iban,
        instruction.destination_account_type, instruction.status,
        instruction.created_at, instruction.updated_at,
      ]);
    }
  }

  // If receiver URL is configured, POST the settlement instruction to them
  const bankCallbackUrl = process.env.INTERNAL_PAYOUT_RECEIVER_URL?.trim();
  const apiKey = process.env.INTERNAL_PAYOUT_RECEIVER_API_KEY?.trim() || '';
  let callbackResponse: any = null;
  let finalStatus = bankCallbackUrl ? 'PENDING' : 'PENDING_RAIL';

  if (bankCallbackUrl) {
    try {
      const headers: any = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const response = await axios.post(bankCallbackUrl, {
        reference: settlementRef,
        payout_id: req.payoutId,
        merchant_id: req.merchantId,
        amount: req.amount,
        currency: req.currency,
        recipient: {
          bank_name: instruction.destination_bank,
          account_holder: instruction.destination_account_holder,
          account_number: instruction.destination_account_number,
          routing_number: instruction.destination_routing,
          swift_code: instruction.destination_swift,
          iban: instruction.destination_iban,
          account_type: instruction.destination_account_type,
        },
        protocol: '201.3',
        acquirer: 'JUKRUTI-INTERNAL',
      }, { headers, timeout: 15000 });

      callbackResponse = response.data;
      finalStatus = 'SENT';
      // Update instruction status
      await db.query(
        `UPDATE payout_settlement_instructions SET status = 'SENT', bank_callback_response = ?, updated_at = ? WHERE id = ?`,
        [JSON.stringify(callbackResponse), new Date().toISOString(), instructionId]
      );
    } catch (callbackErr: any) {
      // Bank callback failed — keep instruction as PENDING for retry.
      console.warn(`[InternalPayout] Bank callback failed for ${settlementRef}: ${callbackErr.message}`);
      await db.query(
        `UPDATE payout_settlement_instructions SET status = 'PENDING', bank_callback_response = ?, updated_at = ? WHERE id = ?`,
        [JSON.stringify({ error: callbackErr.message }), new Date().toISOString(), instructionId]
      );
    }
  }

  console.log(`[InternalPayout] ✅ Settlement instruction created: ${settlementRef} | ${req.currency} ${req.amount} → ${instruction.destination_bank} ${instruction.destination_account_number}`);

  return {
    success: true,
    provider: 'internal',
    providerReference: settlementRef,
    status: finalStatus,
    settlementInstructionId: instructionId,
    raw: {
      instruction,
      bankCallback: callbackResponse,
      downstreamProvider: null,
      message: bankCallbackUrl
        ? `Settlement instruction sent to bank callback (${bankCallbackUrl})`
        : `Settlement instruction stored. Download via GET /api/payout/settlement-instructions/${req.merchantId} or configure INTERNAL_PAYOUT_RECEIVER_URL in .env to auto-push.`,
    },
  };
}
