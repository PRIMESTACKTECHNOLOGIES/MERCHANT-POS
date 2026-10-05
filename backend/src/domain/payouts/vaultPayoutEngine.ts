import { db } from '../../config/db';
import { payoutsService } from './payouts.service';
import { submitBankPayout } from './payoutProvider.service';
import { getActiveVaultCardByAccount, VaultCard } from '../vault/vaultCardService';
import { luhnValidate } from '../vault/luhn';
import { getVaultBin, VAULT_BINS } from '../vault/vaultBin';
import { v4 as uuidv4 } from 'uuid';

export interface VaultPayoutExecutionResult {
  success: true;
  payout_id: string;
  external_reference?: string;
  provider: string;
  provider_status: string;
  channel: string;
  status: string;
}

export interface VaultCardPayoutParams {
  vault_card_pan?: string;
  vault_card_expiry?: string;
  vault_card_cvv?: string;
  vault_account_id?: string;
  amount: number;
  currency: string;
  destination_bank?: {
    bank_name?: string;
    account_name?: string;
    account_holder?: string;
    account_number?: string;
    routing_number?: string;
    swift_bic?: string;
    iban?: string;
    bank_address?: string;
    country?: string;
    city?: string;
    post_code?: string;
    dwolla_funding_source_url?: string;
  };
  reference?: string;
  merchant_id?: string;
  merchantId?: string;
}

export interface VaultCardPayoutResult {
  success: boolean;
  payout_id?: string;
  vault_card: {
    id: string;
    vault_account_id: string;
    last4: string;
    scheme: string;
    bin: string;
  };
  amount: number;
  currency: string;
  status: string;
  external_reference?: string;
  provider?: string;
  provider_status?: string;
  channel?: string;
  network_reference?: string;
  rail?: string;
  error?: string;
}

/**
 * Orchestrates external submission and local vault settlement.
 *
 * Payout creation already validates and reserves funds. This boundary is
 * responsible for submitting the generated instruction to the configured rail
 * and only then finalizing the local vault debit/status transition.
 */
export class VaultPayoutEngine {
  async executePayout(payoutId: string): Promise<VaultPayoutExecutionResult> {
    const payout = await payoutsService.getPayout(payoutId);
    if (!payout) throw Object.assign(new Error('PAYOUT_NOT_FOUND'), { code: 'PAYOUT_NOT_FOUND' });
    if (payout.status !== 'PENDING' && payout.status !== 'QUEUED') {
      throw Object.assign(new Error('PAYOUT_INVALID_STATE'), { code: 'PAYOUT_INVALID_STATE' });
    }
    if (payout.destination_type !== 'bank' || !payout.destination_bank) {
      throw Object.assign(new Error('PAYOUT_DESTINATION_UNSUPPORTED'), { code: 'PAYOUT_DESTINATION_UNSUPPORTED' });
    }

    const providerResult = await submitBankPayout({
      merchantId: payout.merchant_id || 'PROCESSOR',
      payoutId: payout.id,
      amount: Number(payout.amount),
      currency: payout.currency,
      bankAccount: {
        bank_name: payout.destination_bank.bank_name,
        account_holder: payout.destination_bank.account_name || payout.destination_bank.account_holder,
        account_number: payout.destination_bank.account_number,
        routing_number: payout.destination_bank.routing_number,
        swift_code: payout.destination_bank.swift_bic,
        iban: payout.destination_bank.iban,
        bank_address: payout.destination_bank.bank_address,
        country: payout.destination_bank.country,
        city: payout.destination_bank.city,
        post_code: payout.destination_bank.post_code,
        dwolla_funding_source_url: payout.destination_bank.dwolla_funding_source_url,
      },
      reference: payout.internal_reference,
    });

    if (!providerResult.success || String(providerResult.status).toUpperCase() === 'FAILED') {
      throw Object.assign(new Error('PAYOUT_PROVIDER_FAILED'), {
        code: 'PAYOUT_PROVIDER_FAILED',
        details: providerResult.raw || {},
      });
    }

    const finalized = await payoutsService.executePayout(payout.id);
    const externalReference = providerResult.providerReference;
    if (externalReference) {
      await db.query(
        `UPDATE payouts
            SET external_reference = COALESCE(?, external_reference), updated_at = ?
          WHERE id = ?`,
        [externalReference, new Date().toISOString(), payout.id],
      );
    }

    return {
      success: true,
      payout_id: payout.id,
      external_reference: externalReference,
      provider: providerResult.provider,
      provider_status: providerResult.status,
      channel: finalized.channel,
      status: finalized.status,
    };
  }

  /**
   * Execute a payout using a vault settlement card as the funding source.
   *
   * Validates the vault card (Luhn check, scheme, BIN match, status), creates a
   * reservation on the vault account ledger, submits to the configured payout rail,
   * and records the vault-card-backed payout in the ledger.
   *
   * Accepts either:
   *   - explicit vault_card_pan + vault_card_expiry + vault_card_cvv, OR
   *   - vault_account_id (resolves to the ACTIVE card for that account)
   */
  async executeCardPayout(params: VaultCardPayoutParams): Promise<VaultCardPayoutResult> {
    const {
      vault_card_pan,
      vault_card_expiry,
      vault_card_cvv,
      vault_account_id,
      amount,
      currency,
      destination_bank,
      reference,
      merchant_id,
      merchantId,
    } = params;

    const ccy = String(currency || '').toUpperCase();
    const amt = Number(amount);
    const merchantID = String(merchant_id || merchantId || 'PROCESSOR');

    if (!Number.isFinite(amt) || amt <= 0) {
      throw Object.assign(new Error('INVALID_AMOUNT'), { code: 'INVALID_AMOUNT' });
    }
    if (!/^[A-Z]{3}$/.test(ccy)) {
      throw Object.assign(new Error('INVALID_CURRENCY'), { code: 'INVALID_CURRENCY' });
    }
    if (!destination_bank && !reference) {
      // allow internal card-to-card or internal settlement; destination_bank is optional for internal ops
    }

    let vaultCard: VaultCard | null = null;

    if (vault_card_pan) {
      // ── Explicit card credentials provided ──────────────────────────────
      const pan = String(vault_card_pan).replace(/\D/g, '');
      if (!luhnValidate(pan)) {
        throw Object.assign(new Error('INVALID_CARD_LUHN'), { code: 'INVALID_CARD_LUHN' });
      }
      if (pan.length < 13 || pan.length > 19) {
        throw Object.assign(new Error('INVALID_CARD_LENGTH'), { code: 'INVALID_CARD_LENGTH' });
      }
      const bin6 = pan.substring(0, 6);
      const cardRows = await db.query(
        `SELECT id, vault_account_id, bin, card_number, last4, scheme, product, country, expiry, cvv, status, created_at
           FROM vault_cards WHERE card_number = ? LIMIT 1`,
        [pan],
      );
      if (!cardRows.rows.length) {
        throw Object.assign(new Error('CARD_NOT_FOUND'), { code: 'CARD_NOT_FOUND' });
      }
      const row = cardRows.rows[0];
      if (row.status !== 'ACTIVE') {
        throw Object.assign(new Error(`CARD_${row.status}`), { code: `CARD_${row.status}` });
      }
      if (vault_card_expiry && String(vault_card_expiry).trim() !== String(row.expiry).trim()) {
        throw Object.assign(new Error('INVALID_CARD_EXPIRY'), { code: 'INVALID_CARD_EXPIRY' });
      }
      if (vault_card_cvv && String(vault_card_cvv).trim() !== String(row.cvv).trim()) {
        throw Object.assign(new Error('INVALID_CARD_CVV'), { code: 'INVALID_CARD_CVV' });
      }
      const cardVaultAccount = String(row.vault_account_id);
      const expectedBin = getVaultBin(cardVaultAccount);
      if (expectedBin.bin !== row.bin && !Object.values(VAULT_BINS).some(b => b.bin === row.bin)) {
        throw Object.assign(new Error('CARD_BIN_NOT_VAULT'), { code: 'CARD_BIN_NOT_VAULT' });
      }
      vaultCard = {
        id: row.id,
        vault_account_id: cardVaultAccount,
        scheme: row.scheme,
        product: row.product,
        country: row.country,
        bin: row.bin,
        card_number: row.card_number,
        last4: row.last4,
        expiry: row.expiry,
        cvv: row.cvv,
        status: row.status,
        created_at: row.created_at,
      };
    } else if (vault_account_id) {
      // ── Resolve active card by vault account id ─────────────────────────
      vaultCard = await getActiveVaultCardByAccount(String(vault_account_id));
      if (!vaultCard) {
        throw Object.assign(new Error('NO_ACTIVE_VAULT_CARD'), { code: 'NO_ACTIVE_VAULT_CARD' });
      }
    } else {
      throw Object.assign(new Error('VAULT_CARD_OR_ACCOUNT_REQUIRED'), {
        code: 'VAULT_CARD_OR_ACCOUNT_REQUIRED',
      });
    }

    const cardBinInfo = getVaultBin(vaultCard.vault_account_id);

    // ── Verify vault account has sufficient available balance ──────────────────
    const accountRows = await db.query(
      `SELECT id, balance, reserved_hold, currency, available_balance
         FROM vault_accounts WHERE id = ? LIMIT 1`,
      [vaultCard.vault_account_id],
    );
    if (!accountRows.rows.length) {
      throw Object.assign(new Error('VAULT_ACCOUNT_NOT_FOUND'), { code: 'VAULT_ACCOUNT_NOT_FOUND' });
    }
    const vacct = accountRows.rows[0];
    const accountCurrency = String(vacct.currency || ccy).toUpperCase();
    const availableBal = Number(
      vacct.available_balance ?? (Number(vacct.balance || 0) - Number(vacct.reserved_hold || 0)),
    );
    if (accountCurrency !== ccy) {
      // Cross-currency would need FX — reject for explicit safety
      throw Object.assign(new Error(`CURRENCY_MISMATCH: vault account is ${accountCurrency}, payout requested ${ccy}`), {
        code: 'CURRENCY_MISMATCH',
      });
    }
    if (availableBal < amt) {
      throw Object.assign(new Error('INSUFFICIENT_VAULT_FUNDS'), {
        code: 'INSUFFICIENT_VAULT_FUNDS',
        details: { available: availableBal, required: amt, currency: ccy },
      });
    }

    const payoutId = uuidv4();
    const payoutRef = reference || `VC-${payoutId.slice(0, 12).toUpperCase()}`;
    const now = new Date().toISOString();
    const schemeUpper = String(vaultCard.scheme || cardBinInfo.scheme || 'VISA').toUpperCase();

    // ── Reserve funds (place a hold) on the vault account ──────────────
    const holdGroupId = `HOLD-${payoutId.slice(0, 10)}`;
    const holdEntryId = uuidv4();
    try {
      await db.query('BEGIN IMMEDIATE');
      await db.query(
        `UPDATE vault_accounts
            SET reserved_hold = COALESCE(reserved_hold, 0) + ?,
                payout_in_progress = COALESCE(payout_in_progress, 0) + ?,
                updated_at = ?
          WHERE id = ?`,
        [amt, amt, now, vaultCard.vault_account_id],
      );
      await db.query(
        `INSERT INTO vault_entries
            (id, group_id, account_id, direction, amount, currency, source, reference, status, metadata, created_at)
          VALUES (?, ?, ?, 'debit', ?, ?, 'vault_card_payout', ?, 'POSTED', ?, ?)`,
        [
          holdEntryId,
          holdGroupId,
          vaultCard.vault_account_id,
          amt,
          ccy,
          payoutRef,
          JSON.stringify({
            vault_card_id: vaultCard.id,
            vault_card_last4: vaultCard.last4,
            vault_card_scheme: schemeUpper,
            destination_bank: destination_bank || null,
            merchant_id: merchantID,
            phase: 'RESERVED',
          }),
          now,
        ],
      );
      await db.query('COMMIT');
    } catch (beginErr: any) {
      try { await db.query('ROLLBACK'); } catch (_) {}
      throw Object.assign(new Error(beginErr?.message || 'Failed to reserve vault funds'), {
        code: beginErr?.code || 'VAULT_RESERVE_FAILED',
      });
    }

    // ── Submit to the payout rail (if destination_bank provided) ────────────
    let providerReference: string | undefined;
    let providerName: string = 'VAULT_CARD_INTERNAL';
    let providerStatus: string = 'COMPLETED';
    let finalizedChannel: string = 'vault_card_internal';

    if (destination_bank && (destination_bank.iban || destination_bank.account_number || destination_bank.dwolla_funding_source_url)) {
      try {
        const submitResult = await submitBankPayout({
          merchantId: merchantID,
          payoutId,
          amount: amt,
          currency: ccy,
          bankAccount: {
            bank_name: destination_bank.bank_name,
            account_holder: destination_bank.account_name || destination_bank.account_holder,
            account_number: destination_bank.account_number,
            routing_number: destination_bank.routing_number,
            swift_code: destination_bank.swift_bic,
            iban: destination_bank.iban,
            bank_address: destination_bank.bank_address,
            country: destination_bank.country,
            city: destination_bank.city,
            post_code: destination_bank.post_code,
            dwolla_funding_source_url: destination_bank.dwolla_funding_source_url,
          },
          reference: payoutRef,
          fundingSource: {
            type: 'card',
            scheme: schemeUpper,
            bin: vaultCard.bin,
            last4: vaultCard.last4,
            vault_card_id: vaultCard.id,
            vault_account_id: vaultCard.vault_account_id,
          },
        } as any);

        if (!submitResult.success || String(submitResult.status).toUpperCase() === 'FAILED') {
          // rollback reservation
          try {
            await db.query('BEGIN IMMEDIATE');
            await db.query(
              `UPDATE vault_accounts
                  SET reserved_hold = MAX(0, COALESCE(reserved_hold, 0) - ?),
                      payout_in_progress = MAX(0, COALESCE(payout_in_progress, 0) - ?),
                      updated_at = ?
                WHERE id = ?`,
              [amt, amt, now, vaultCard.vault_account_id],
            );
            const revertId = uuidv4();
            await db.query(
              `INSERT INTO vault_entries
                  (id, group_id, account_id, direction, amount, currency, source, reference, status, metadata, created_at)
                VALUES (?, ?, ?, 'credit', ?, ?, 'vault_card_payout_reversal', ?, 'POSTED', ?, ?)`,
              [
                revertId,
                holdGroupId,
                vaultCard.vault_account_id,
                amt,
                ccy,
                payoutRef,
                JSON.stringify({ reason: 'RAIL_SUBMIT_FAILED', rail_error: submitResult.raw || submitResult.status }),
                now,
              ],
            );
            await db.query('COMMIT');
          } catch (_rollback) { /* best effort */ }
          throw Object.assign(new Error('VAULT_CARD_RAIL_FAILED'), {
            code: 'VAULT_CARD_RAIL_FAILED',
            details: submitResult.raw || {},
          });
        }

        providerReference = submitResult.providerReference;
        providerName = submitResult.provider;
        providerStatus = submitResult.status;
        finalizedChannel = submitResult.rail || 'bank_rail';
      } catch (railErr: any) {
        try {
          await db.query('BEGIN IMMEDIATE');
          await db.query(
            `UPDATE vault_accounts
                SET reserved_hold = MAX(0, COALESCE(reserved_hold, 0) - ?),
                    payout_in_progress = MAX(0, COALESCE(payout_in_progress, 0) - ?),
                    updated_at = ?
              WHERE id = ?`,
            [amt, amt, now, vaultCard.vault_account_id],
          );
          await db.query('COMMIT');
        } catch (_) {}
        throw Object.assign(new Error(railErr?.message || 'Vault card rail submission failed'), {
          code: railErr?.code || 'VAULT_CARD_RAIL_ERROR',
        });
      }
    }

    // ── Finalize: move reserved funds → settle the vault account debit ────
    const settleId = uuidv4();
    await db.query('BEGIN IMMEDIATE');
    try {
      await db.query(
      `UPDATE vault_accounts
          SET balance = balance - ?,
              reserved_hold = MAX(0, COALESCE(reserved_hold, 0) - ?),
              payout_in_progress = MAX(0, COALESCE(payout_in_progress, 0) - ?),
              available_balance = COALESCE(available_balance, balance - COALESCE(reserved_hold, 0)) - ?,
              updated_at = ?
        WHERE id = ?`,
      [amt, amt, amt, amt, now, vaultCard.vault_account_id],
    );
    await db.query(
      `INSERT INTO vault_entries
          (id, group_id, account_id, direction, amount, currency, source, reference, status, metadata, created_at)
        VALUES (?, ?, ?, 'debit', ?, ?, 'vault_card_payout_settled', ?, 'POSTED', ?, ?)`,
      [
        settleId,
        holdGroupId,
        vaultCard.vault_account_id,
        amt,
        ccy,
        payoutRef,
        JSON.stringify({
          vault_card_id: vaultCard.id,
          vault_card_last4: vaultCard.last4,
          vault_card_scheme: schemeUpper,
          provider_reference: providerReference,
          provider: providerName,
          channel: finalizedChannel,
          destination_bank: destination_bank || null,
          merchant_id: merchantID,
        }),
        now,
      ],
    );
    await db.query('COMMIT');
    } catch (settleErr: any) {
      try { await db.query('ROLLBACK'); } catch (_) {}
      throw Object.assign(new Error(settleErr?.message || 'Failed to settle vault card payout'), {
        code: settleErr?.code || 'VAULT_SETTLE_FAILED',
      });
    }

    const networkRef = `${schemeUpper.slice(0, 2)}${Date.now().toString(36).toUpperCase()}`;

    return {
      success: true,
      payout_id: payoutId,
      vault_card: {
        id: vaultCard.id,
        vault_account_id: vaultCard.vault_account_id,
        last4: vaultCard.last4,
        scheme: schemeUpper,
        bin: vaultCard.bin,
      },
      amount: amt,
      currency: ccy,
      status: 'COMPLETED',
      external_reference: providerReference,
      provider: providerName,
      provider_status: providerStatus,
      channel: finalizedChannel,
      network_reference: networkRef,
      rail: schemeUpper === 'MASTERCARD' ? 'MC_SEND' : schemeUpper === 'VISA' ? 'VISA_DIRECT' : 'LOCAL_RAIL',
    };
  }
}

export const vaultPayoutEngine = new VaultPayoutEngine();
