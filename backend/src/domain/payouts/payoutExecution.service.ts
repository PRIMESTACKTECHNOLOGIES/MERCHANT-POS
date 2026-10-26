/**
 * Payout execution — debit the wallet, generate the wire file, push the rail.
 * ─────────────────────────────────────────────────────────────────────────────
 * Split out of bank.router.ts so it runs at exactly one point in the lifecycle:
 * after the approval tier is satisfied. Creation only records the request.
 */

import { debitMerchantWallet } from './payoutHelpers';
import { submitBankPayout } from './payoutProvider.service';
import { executeInternalPayout } from './internalPayoutProvider';
import { generatePayoutWireFiles } from './payoutWire.service';
import { db } from '../../config/db';
import { logPayoutEvent } from './payoutApproval.service';

export interface PayoutExecutionInput {
  payoutId: string;
  merchantId: string;
  amount: number;
  currency: string;
  bankAccount: any;
  bankAccountId?: string | null;
  resolvedLabel?: string;
  providerMode: string;
  metaPayload: Record<string, any>;
  actor?: string | null;
}

export interface PayoutExecutionResult {
  status: string;
  provider: string | null;
  providerReference: string | null;
  wireFiles: any;
  message: string;
}

/** Debits the merchant wallet, generates the SEPA/MT103 file and pushes the rail. */
export async function executePayout(input: PayoutExecutionInput): Promise<PayoutExecutionResult> {
  const { payoutId, merchantId, amount, currency, bankAccount, providerMode } = input;
  const isManual = providerMode === 'manual' || providerMode === '' || providerMode == null;
  const isInternal = providerMode === 'internal';

  try {
    // The debit is the point of no return, so it happens only now — after the
    // approval tier has been satisfied.
    await debitMerchantWallet(
      merchantId,
      Number(amount),
      'payout',
      'bank_payout',
      { bank_account: bankAccount, bank_account_id: input.bankAccountId || null },
      currency
    );
  } catch (e: any) {
    await db.query(
      `UPDATE merchant_payouts
          SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND merchant_id = ?`,
      [e.message || String(e), payoutId, merchantId]
    );
    await logPayoutEvent(payoutId, input.actor || null, 'EXECUTION_BLOCKED', {
      reason: 'WALLET_DEBIT_FAILED',
      error: e.message || String(e),
    });
    throw e;
  }

  let wireFiles: any = null;

  if (isManual) {
    const message =
      'Merchant bank withdrawal approved. Merchant wallet has been debited. Once the funds physically arrive ' +
      'in the destination bank (any method — deposit/cash/wire/ACH), confirm arrival to close the payout.';
    await db.query(
      `UPDATE merchant_payouts
          SET status = 'PENDING_BANK_CONFIRMATION', provider = 'manual', meta = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [JSON.stringify({ ...input.metaPayload, provider: 'manual' }), payoutId]
    );
    await logPayoutEvent(payoutId, input.actor || null, 'BANK_SENT', { mode: 'manual' });
    return { status: 'PENDING_BANK_CONFIRMATION', provider: 'manual', providerReference: null, wireFiles, message };
  }

  if (isInternal) {
    const downstream = process.env.INTERNAL_PAYOUT_DOWNSTREAM?.trim().toLowerCase() || '';
    const railActive = ['iso8583', 'iso8583-tcp', 'vaultbank_iso8583', 'dwolla', 'vaultbank_dwolla'].includes(downstream);

    // 1) Settlement instruction — audit record, pushed to the bank callback
    //    (INTERNAL_PAYOUT_RECEIVER_URL) when one is configured.
    const internalResult = await executeInternalPayout({
      merchantId,
      payoutId,
      amount: Number(amount),
      currency,
      bankAccount,
      reference: payoutId,
    });

    // 2) SEPA / MT103 wire files for the destination bank, so the payout can be
    //    uploaded to the bank (e.g. Banking Circle DE96… / SXPYDEHH).
    wireFiles = await generatePayoutWireFiles({
      merchantId,
      payoutId,
      amount: Number(amount),
      currency,
      bankAccount,
      remittanceInfo: `POS 201.3 SETTLEMENT ${merchantId} REF ${payoutId.slice(0, 8)}`,
    });
    await logPayoutEvent(payoutId, input.actor || null, 'FILE_GENERATED', {
      mt103: wireFiles?.mt103?.reference || null,
      uetr: wireFiles?.mt103?.uetr || null,
      sepa_msg_id: wireFiles?.sepa?.msg_id || null,
      errors: wireFiles?.errors || [],
    });

    // 3) Internal iso8583 / dwolla rail — push the payout when INTERNAL_PAYOUT_
    //    DOWNSTREAM is configured. An unreachable rail must not fail the payout:
    //    the wire file + settlement instruction stay the source of truth.
    let railResult: any = null;
    if (railActive) {
      try {
        railResult = await submitBankPayout({
          merchantId,
          payoutId,
          amount: Number(amount),
          currency,
          bankAccount,
          reference: payoutId,
        });
      } catch (railErr: any) {
        railResult = {
          success: false,
          provider: 'internal',
          rail: downstream,
          status: 'RAIL_UNAVAILABLE',
          raw: { error: railErr.message },
        };
      }
    }

    const railAccepted = Boolean(railResult?.success)
      && ['SUBMITTED', 'QUEUED', 'PROCESSED', 'PENDING'].includes(String(railResult?.status || '').toUpperCase());

    const finalStatus = railAccepted ? railResult.status : internalResult.status;
    const finalReference = railResult?.providerReference || internalResult.providerReference;
    const message = railAccepted
      ? `Internal acquirer pushed the payout on the ${railResult.rail || downstream} rail. Ref: ${finalReference}. Destination: ${bankAccount?.bank_name || 'the destination bank'}.`
      : `Internal acquirer payout recorded. Ref: ${internalResult.providerReference}. ` +
        `SEPA/MT103 wire file generated — upload it to ${bankAccount?.bank_name || 'the destination bank'}.` +
        (wireFiles?.errors?.length ? ` Wire file issues: ${wireFiles.errors.join('; ')}.` : '');

    await db.query(
      `UPDATE merchant_payouts
          SET status = ?,
              provider = 'internal',
              provider_reference = ?,
              meta = ?,
              completed_at = CASE WHEN ? IN ('COMPLETED','SENT','OUTGOING_PAYMENT_SENT','CONVERTED') THEN CURRENT_TIMESTAMP ELSE completed_at END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [
        finalStatus,
        finalReference,
        JSON.stringify({
          ...input.metaPayload,
          provider: 'internal',
          downstream,
          rail: railResult,
          wire_files: wireFiles,
          raw: { settlement: internalResult.raw, rail: railResult, wire_files: wireFiles },
        }),
        String(finalStatus || '').toUpperCase(),
        payoutId,
      ]
    );
    if (railAccepted) {
      await logPayoutEvent(payoutId, input.actor || null, 'BANK_SENT', {
        rail: railResult.rail || downstream,
        provider_reference: finalReference,
      });
    }
    return { status: finalStatus, provider: 'internal', providerReference: finalReference, wireFiles, message };
  }

  // Live external provider.
  const payoutResult = await submitBankPayout({
    merchantId,
    payoutId,
    amount: Number(amount),
    currency,
    bankAccount,
    reference: payoutId,
  });
  const finalStatus = payoutResult.status || 'submitted';
  const finalProvider = payoutResult.provider || null;
  const finalReference = payoutResult.providerReference || null;

  await db.query(
    `UPDATE merchant_payouts
        SET status = ?,
            provider = ?,
            provider_reference = ?,
            meta = ?,
            completed_at = CASE WHEN ? IN ('COMPLETED','SENT','OUTGOING_PAYMENT_SENT','CONVERTED') THEN CURRENT_TIMESTAMP ELSE completed_at END,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [
      finalStatus,
      finalProvider,
      finalReference,
      JSON.stringify({ ...input.metaPayload, provider: finalProvider, raw: payoutResult.raw }),
      String(finalStatus || '').toUpperCase(),
      payoutId,
    ]
  );
  await logPayoutEvent(payoutId, input.actor || null, 'BANK_SENT', {
    provider: finalProvider,
    provider_reference: finalReference,
  });
  return {
    status: finalStatus,
    provider: finalProvider,
    providerReference: finalReference,
    wireFiles,
    message: 'Bank payout request submitted to live provider.',
  };
}

export default { executePayout };
