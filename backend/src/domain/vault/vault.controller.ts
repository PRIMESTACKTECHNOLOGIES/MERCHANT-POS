import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import { generateUetr } from '../../utils/uetr.generator';
import { buildPain001Xml } from '../../utils/pain001.builder';
import path from 'path';
import fs from 'fs';
import { vaultEngine } from './vault.service';
import { reconcileVault } from './reconciliation.service';
import { reserveEngine } from './reserve.service';
import { getVaultLiquidity, listVaultLiquidityLog } from './liquidity.service';
import { getVaultAudit, listVaultAudit, verifyVaultAuditChain } from './audit.service';
import {
  createVaultAccount,
  creditVaultAccount,
  createVaultPayout,
  confirmVaultPayout,
  failVaultPayout,
  listControlledAccounts,
  getControlledReconciliation,
  listControlledEntries,
  listControlledEvents,
} from './controlledBalance.service';
import {
  issueVaultCard as issueVaultCardSvc,
  issueVaultBankCard as issueVaultBankCardSvc,
  getVaultCardsByAccount,
  getAllVaultCards,
  getVaultCardById,
  getActiveVaultCardByAccount,
  updateVaultCardStatus,
  VaultCard,
} from './vaultCardService';
import {
  generateVaultCardNetworkAuth,
  generateVaultCardNetworkCodes,
} from './vaultCardNetwork';

const BACKEND_ROOT = path.join(__dirname, '..', '..', '..');

export class VaultController {
  async createControlledAccount(req: Request, res: Response) {
    try {
      return res.status(201).json(await createVaultAccount({
        ownerId: String(req.body?.owner_id || req.body?.ownerId || ''),
        type: req.body?.type,
        currency: req.body?.currency,
        bankName: req.body?.bank_name || req.body?.bankName,
        iban: req.body?.iban,
        bic: req.body?.bic,
      }));
    } catch (e: any) {
      return res.status(e?.code === 'VALIDATION_ERROR' ? 400 : 500)
        .json({ error: e?.code || 'INTERNAL_ERROR', message: e?.message || 'Failed to create vault account' });
    }
  }

  async listControlledAccounts(req: Request, res: Response) {
      try {
        return res.json(await listControlledAccounts(
          req.query.owner_id ? String(req.query.owner_id) : undefined,
          req.query.currency ? String(req.query.currency) : undefined,
        ));
      } catch (e: any) {
        return res.status(e?.code === 'VALIDATION_ERROR' ? 400 : 500)
          .json({ error: e?.code || 'INTERNAL_ERROR', message: e?.message || 'Failed to load controlled vault accounts' });
      }
  }

  async controlledReconciliation(req: Request, res: Response) {
      try {
        return res.json(await getControlledReconciliation(req.params.id));
      } catch (e: any) {
        return res.status(e?.code === 'ACCOUNT_NOT_FOUND' ? 404 : 500)
          .json({ error: e?.code || 'INTERNAL_ERROR', message: e?.message || 'Failed to reconcile controlled vault account' });
      }
  }

  async controlledEntries(req: Request, res: Response) {
      try {
        return res.json(await listControlledEntries(req.params.id, Number(req.query.limit || 100)));
      } catch (e: any) {
        return res.status(e?.code === 'ACCOUNT_NOT_FOUND' ? 404 : 500)
          .json({ error: e?.code || 'INTERNAL_ERROR', message: e?.message || 'Failed to load vault statement' });
      }
  }

  async controlledEvents(req: Request, res: Response) {
      try {
        return res.json(await listControlledEvents(req.params.id, Number(req.query.limit || 100)));
      } catch (e: any) {
        return res.status(e?.code === 'ACCOUNT_NOT_FOUND' ? 404 : 500)
          .json({ error: e?.code || 'INTERNAL_ERROR', message: e?.message || 'Failed to load vault events' });
    }
  }

  async creditControlledAccount(req: Request, res: Response) {
    try {
      return res.status(201).json(await creditVaultAccount({
        accountId: String(req.body?.account_id || req.body?.accountId || ''),
        amount: req.body?.amount,
        currency: req.body?.currency,
        source: req.body?.source,
        reference: String(req.body?.reference || ''),
        holdType: req.body?.hold_type || req.body?.holdType,
        metadata: req.body?.metadata,
      }));
    } catch (e: any) {
      return res.status(e?.code === 'VALIDATION_ERROR' ? 400 : e?.code === 'ACCOUNT_NOT_FOUND' ? 404 : 500)
        .json({ error: e?.code || 'INTERNAL_ERROR', message: e?.message || 'Failed to credit vault account' });
    }
  }

  async createControlledPayout(req: Request, res: Response) {
    try {
      return res.status(201).json(await createVaultPayout({
        fromAccountId: String(req.body?.from_account_id || req.body?.fromAccountId || ''),
        amount: req.body?.amount,
        currency: req.body?.currency,
        reference: String(req.body?.reference || ''),
        beneficiary: req.body?.to_beneficiary_bank_account || req.body?.beneficiary || {},
        channel: req.body?.channel,
      }));
    } catch (e: any) {
      const status = e?.code === 'NO_FUNDS' ? 409 : e?.code === 'ACCOUNT_NOT_FOUND' ? 404 : e?.code === 'VALIDATION_ERROR' ? 400 : 500;
      return res.status(status).json({ error: e?.code || 'INTERNAL_ERROR', message: e?.message || 'Failed to create vault payout' });
    }
  }

  async confirmControlledPayout(req: Request, res: Response) {
    try {
      const externalReference = String(req.body?.external_reference || req.body?.externalReference || '');
      if (!externalReference) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'external_reference is required' });
      return res.json(await confirmVaultPayout(req.params.id, externalReference));
    } catch (e: any) {
      return res.status(e?.code === 'NOT_FOUND' ? 404 : e?.code === 'INVALID_STATE' ? 409 : 500)
        .json({ error: e?.code || 'INTERNAL_ERROR', message: e?.message || 'Failed to confirm vault payout' });
    }

    }

  async failControlledPayout(req: Request, res: Response) {
      try {
        return res.json(await failVaultPayout(
          req.params.id,
          String(req.body?.error_message || req.body?.errorMessage || 'Bank payout failed'),
        ));
      } catch (e: any) {
        return res.status(e?.code === 'NOT_FOUND' ? 404 : e?.code === 'INVALID_STATE' ? 409 : 500)
          .json({ error: e?.code || 'INTERNAL_ERROR', message: e?.message || 'Failed to release vault payout hold' });
      }
    }
  async getAudit(req: Request, res: Response) {
    try {
      return res.json(await listVaultAudit({
        event: req.query.event ? String(req.query.event) : undefined,
        merchantId: req.query.merchantId ? String(req.query.merchantId) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      }));
    } catch (e: any) {
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || 'Failed to load audit trail' });
    }
  }

  async getAuditEntry(req: Request, res: Response) {
    const entry = await getVaultAudit(req.params.id);
    return entry ? res.json(entry) : res.status(404).json({ error: 'NOT_FOUND', message: 'Audit entry not found' });
  }

  async verifyAudit(req: Request, res: Response) {
    try { return res.json(await verifyVaultAuditChain()); }
    catch (e: any) { return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || 'Failed to verify audit chain' }); }
  }
  async getLiquidity(req: Request, res: Response) {
    try {
      return res.json(await getVaultLiquidity(String(req.query.currency || 'EUR')));
    } catch (e: any) {
      return res.status(400).json({ error: e?.code || 'VALIDATION_ERROR', message: e?.message || 'Failed to calculate liquidity' });
    }
  }

  async getLiquidityLog(req: Request, res: Response) {
      try {
        return res.json(await listVaultLiquidityLog(String(req.query.currency || 'EUR')));
      } catch (e: any) {
        return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || 'Failed to load liquidity history' });
    }
  }
  async createReserve(req: Request, res: Response) {
    try {
      return res.status(201).json((await reserveEngine.createReserve({
        merchantId: String(req.body?.merchantId || req.body?.merchant_id || ''),
        amount: Number(req.body?.amount),
        currency: String(req.body?.currency || '').toUpperCase(),
        reason: req.body?.reason,
        releaseTs: req.body?.releaseTs || req.body?.release_ts,
        meta: req.body?.meta,
      })).reserve);
    } catch (e: any) {
      return res.status(e?.code === 'NO_FUNDS' ? 409 : e?.code === 'VALIDATION_ERROR' ? 400 : 500)
        .json({ error: e?.code || 'INTERNAL_ERROR', message: e?.message || 'Failed to create reserve' });
    }
  }

  async releaseReserve(req: Request, res: Response) {
    try { return res.json((await reserveEngine.releaseReserve(String(req.body?.reserveId || req.body?.reserve_id))).reserve); }
    catch (e: any) { return res.status(e?.code === 'NOT_FOUND' ? 404 : e?.code === 'INVALID_STATE' ? 409 : e?.code === 'NO_FUNDS' ? 409 : 500).json({ error: e?.code || 'INTERNAL_ERROR', message: e?.message }); }
  }

  async cancelReserve(req: Request, res: Response) {
    try { return res.json(await reserveEngine.cancelReserve(String(req.body?.reserveId || req.body?.reserve_id))); }
    catch (e: any) { return res.status(e?.code === 'NOT_FOUND' ? 404 : e?.code === 'INVALID_STATE' ? 409 : 500).json({ error: e?.code || 'INTERNAL_ERROR', message: e?.message }); }
  }

  async listReserves(req: Request, res: Response) {
    try { return res.json(await reserveEngine.listReserves(req.query.status ? String(req.query.status) : undefined)); }
    catch (e: any) { return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || 'Failed to list reserves' }); }
  }
  async getReconciliation(req: Request, res: Response) {
    try {
      return res.json(await reconcileVault(String(req.query.currency || 'EUR')));
    } catch (e: any) {
      return res.status(400).json({ error: e?.code || 'VALIDATION_ERROR', message: e?.message || 'Failed to reconcile vault' });
    }
  }
  async creditVault(req: Request, res: Response) {
    try {
      const { amount, currency, reference, merchantId, type, meta } = req.body || {};
      const entry = await vaultEngine.creditVault({
        amount: Number(amount),
        currency: String(currency || '').toUpperCase(),
        reference: String(reference || ''),
        merchantId,
        type,
        meta,
      });
      return res.status(201).json(entry);
    } catch (e: any) {
      console.error('[Vault:credit]', e);
      return res.status(e?.code === 'VALIDATION_ERROR' ? 400 : 500).json({
        error: e?.code || 'INTERNAL_ERROR',
        message: e?.message || 'Failed to credit vault',
      });
    }
  }

  async debitVault(req: Request, res: Response) {
    try {
      const { amount, currency, reference, merchantId, type, meta } = req.body || {};
      const entry = await vaultEngine.debitVault({
        amount: Number(amount),
        currency: String(currency || '').toUpperCase(),
        reference: String(reference || ''),
        merchantId,
        type,
        meta,
      });
      return res.status(201).json(entry);
    } catch (e: any) {
      console.error('[Vault:debit]', e);
      const status = e?.code === 'VALIDATION_ERROR' ? 400 : e?.code === 'NO_FUNDS' ? 409 : 500;
      return res.status(status).json({ error: e?.code || 'INTERNAL_ERROR', message: e?.message || 'Failed to debit vault' });
    }
  }

  async getVaultBalance(req: Request, res: Response) {
    try {
      const currency = String(req.query.currency || 'USD').toUpperCase();
      return res.json({ currency, balance: await vaultEngine.getVaultBalance(currency) });
    } catch (e: any) {
      return res.status(400).json({ error: e?.code || 'VALIDATION_ERROR', message: e?.message });
    }
  }

  async getVaultLedger(req: Request, res: Response) {
    try {
      const rows = await vaultEngine.listLedger({
        currency: req.query.currency ? String(req.query.currency) : undefined,
        type: req.query.type ? String(req.query.type) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      return res.json(rows);
    } catch (e: any) {
      return res.status(400).json({ error: e?.code || 'VALIDATION_ERROR', message: e?.message });
    }
  }

  async getStats(_req: Request, res: Response) {
    try {
      const [vaultByCurrency, confirmedRealFunds, merchants, pendingSettlements, pendingPayouts, offline, stored] = await Promise.all([
        db.query(`SELECT currency, COALESCE(SUM(
          CASE
            WHEN type IN ('VAULT_TO_MERCHANT', 'VAULT_TO_BANK') THEN -ABS(amount)
            WHEN type IN ('MERCHANT_TO_VAULT', 'BATCH_TO_VAULT', 'ADJUSTMENT') THEN ABS(amount)
            WHEN id LIKE 'settlement:%' OR id LIKE 'payout:%' THEN -ABS(amount)
            ELSE 0
          END
        ), 0) AS total FROM vault_ledger WHERE status = 'COMPLETED' GROUP BY currency`),
        db.query(`SELECT currency, COALESCE(SUM(available_amount), 0) AS total
                    FROM vault_real_funds
                   WHERE source = 'signed-bank-webhook'
                   GROUP BY currency`),
        db.query(`SELECT COALESCE(SUM(balance), 0) AS total FROM merchant_wallets`),
        db.query(`SELECT currency, COALESCE(SUM(amount), 0) AS total
                    FROM batch_settlement
                   WHERE status = 'PENDING'
                   GROUP BY currency`),
        db.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM payout_instructions WHERE status IN ('QUEUED', 'PROCESSING')`),
        db.query(`SELECT COUNT(*) AS total FROM offline_txns`),
        db.query(`SELECT COUNT(*) AS total FROM stored_txns`),
      ]);
      const vaultBalancesByCurrency = Object.fromEntries(
        (vaultByCurrency.rows || []).map((row: any) => [String(row.currency).toUpperCase(), Number(row.total || 0)]),
      );
      const confirmedRealFundsByCurrency = Object.fromEntries(
        (confirmedRealFunds.rows || []).map((row: any) => [String(row.currency).toUpperCase(), Number(row.total || 0)]),
      );
      const pendingSettlementsByCurrency = Object.fromEntries(
        (pendingSettlements.rows || []).map((row: any) => [String(row.currency).toUpperCase(), Number(row.total || 0)]),
      );
      return res.json({
        // totalVaultBalance = BATCH_TO_VAULT credits (real merchant transfers) 
        // + signed bank webhook funds - VAULT_TO_BANK debits
        totalVaultBalance: Number(vaultBalancesByCurrency['USD'] || 0) + Number(confirmedRealFundsByCurrency['USD'] || 0),
        confirmedRealFundsByCurrency,
        vaultBalancesByCurrency,
        totalPendingSettlement: Number(pendingSettlementsByCurrency.USD || 0),
        pendingSettlementsByCurrency,
        totalMerchantBalances: Number(merchants.rows?.[0]?.total || 0),
        totalPendingPayouts: Number(pendingPayouts.rows?.[0]?.total || 0),
        totalOfflineApprovals: Number(offline.rows?.[0]?.total || 0),
        totalStoredTransactions: Number(stored.rows?.[0]?.total || 0),
      });
    } catch (e: any) {
      console.error('[Vault:getStats]', e);
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || 'Failed to load vault stats' });
    }
  }

  async getProviderFunds(req: Request, res: Response) {
    try {
      const currency = String(req.query.currency || 'USD').toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Currency must be a three-letter ISO code' });
      }

      const table = await db.query(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'card_settlements' LIMIT 1`
      );
      if (!table.rows?.length) {
        return res.json({
          currency,
          creditedFunds: 0,
          transactionCount: 0,
          lastCreditedAt: null,
          source: 'provider_capture',
          verified: true,
        });
      }

      const result = await db.query(
        `SELECT COALESCE(SUM(amount), 0) AS creditedFunds,
                COUNT(*) AS transactionCount,
                MAX(created_at) AS lastCreditedAt
           FROM card_settlements
          WHERE currency = ? AND status = 'SETTLED'`,
        [currency]
      );
      const row = result.rows?.[0] || {};
      const merchantCard = await db.query(
        `SELECT card_id FROM merchant_wallets WHERE merchant_id = ? AND currency = ? LIMIT 1`,
        ['MRC-1001', currency]
      );
      return res.json({
        currency,
        creditedFunds: Number(row.creditedFunds || 0),
        transactionCount: Number(row.transactionCount || 0),
        lastCreditedAt: row.lastCreditedAt || null,
        source: 'provider_capture',
        verified: true,
        merchantId: 'MRC-1001',
        walletId: null,
        cardId: merchantCard.rows?.[0]?.card_id || null,
        authenticatedCard: Boolean(merchantCard.rows?.[0]?.card_id),
      });
    } catch (e: any) {
      console.error('[Vault:getProviderFunds]', e);
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || 'Failed to load provider-confirmed funds' });
    }
  }

  async getTransfers(_req: Request, res: Response) {
    try {
      const result = await db.query(`
        SELECT id, ts, merchant_id AS merchantId,
               CASE
                 WHEN type IN ('VAULT_TO_MERCHANT', 'VAULT_TO_BANK') THEN -ABS(amount)
                 WHEN type IN ('MERCHANT_TO_VAULT', 'BATCH_TO_VAULT', 'CARD_CAPTURE') THEN ABS(amount)
                 WHEN id LIKE 'settlement:%' OR id LIKE 'payout:%' THEN -ABS(amount)
                 ELSE amount
               END AS amount,
               currency,
               reference, status, type
          FROM vault_ledger
         ORDER BY ts DESC
         LIMIT 500
      `);
      return res.json((result.rows || []).map((row: any) => ({
        ...row,
        amount: Number(row.amount),
        status: String(row.status || '').toUpperCase() === 'SETTLED' ? 'COMPLETED' : String(row.status || '').toUpperCase(),
      })));
    } catch (e: any) {
      console.error('[Vault:getTransfers]', e);
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || 'Failed to load vault transfers' });
    }
  }

  async getBatchSettlements(_req: Request, res: Response) {
    try {
      const result = await db.query(`
        SELECT id, batch_id AS batchId, merchant_id AS merchantId,
               amount, currency, status, settlement_ref AS settlementRef, ts
          FROM batch_settlement
         ORDER BY ts DESC
         LIMIT 500
      `);
      return res.json((result.rows || []).map((row: any) => ({ ...row, amount: Number(row.amount) })));
    } catch (e: any) {
      console.error('[Vault:getBatchSettlements]', e);
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || 'Failed to load batch settlements' });
    }
  }

  async getPayouts(_req: Request, res: Response) {
    try {
      const result = await db.query(`
        SELECT id, merchant_id AS merchantId, amount, currency,
               bank_name AS bankName, status, ts, provider_ref AS providerRef
          FROM payout_instructions
         ORDER BY ts DESC
         LIMIT 500
      `);
      return res.json((result.rows || []).map((row: any) => ({
        ...row,
        amount: Number(row.amount),
        bankName: String(row.bankName || '').replace(/^"|"$/g, ''),
      })));
    } catch (e: any) {
      console.error('[Vault:getPayouts]', e);
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || 'Failed to load vault payouts' });
    }
  }

  async getAccounts(_req: Request, res: Response) {
    try {
      // Return vault accounts with balance derived from the ledger SUM (source of truth)
      // This ensures only real captured funds are shown — no manually seeded amounts.
      const result = await db.query(`
        SELECT
          va.id, va.bank_name, va.bic, va.iban, va.currency, va.type,
          va.reserved_hold, va.last_reconciled, va.created_at, va.updated_at,
          COALESCE((
            SELECT SUM(vl.amount)
            FROM vault_ledger vl
            WHERE vl.currency = va.currency AND vl.status = 'COMPLETED'
          ), 0) AS balance
        FROM vault_accounts va
        ORDER BY va.created_at ASC
      `);
      res.json(result.rows);
    } catch (e: any) {
      console.error('[Vault:getAccounts]', e);
      res.status(500).json({ error: e.message || 'Failed to load vault accounts' });
    }
  }

  async getBeneficiaries(req: Request, res: Response) {
    try {
      const includeArchived = req.query.include_archived === 'true';
      const sql = includeArchived
        ? 'SELECT * FROM vault_beneficiaries ORDER BY created_at DESC'
        : 'SELECT * FROM vault_beneficiaries WHERE is_archived = 0 ORDER BY created_at DESC';
      const result = await db.query(sql);
      res.json(result.rows);
    } catch (e: any) {
      console.error('[Vault:getBeneficiaries]', e);
      res.status(500).json({ error: e.message || 'Failed to load beneficiaries' });
    }
  }

  async createBeneficiary(req: Request, res: Response) {
    try {
      const body = req.body || {};
      const {
        beneficiary_legal_name: legalName,
        beneficiary_address_line1,
        beneficiary_address_line2,
        beneficiary_city,
        beneficiary_country,
        beneficiary_phone,
        receiving_bank_name,
        receiving_bank_address_line1,
        receiving_bank_address_line2,
        receiving_bank_city,
        receiving_bank_country,
        receiving_bank_swift_bic,
        receiving_bank_routing_number,
        receiving_bank_sort_code,
        receiving_bank_local_clearing_code,
        account_number,
        iban,
        supported_currency,
        account_type,
        transfer_type,
        network_code,
        payment_purpose_code,
        payment_description,
        end_to_end_id,
        beneficiary_reference,
        vault_customer_id,
        vault_wallet_id,
        vault_card_reference,
        vault_settlement_batch_id,
        vault_transaction_id,
        internal_note,
        name,
        type,
        bank,
        address: addressObject,
        metadata,
      } = body;
      const normalizedName = legalName || name;
      const swift = bank?.swift_bic || req.body?.swift;
      const normalizedIban = iban || bank?.iban;
      const accountNumber = account_number || bank?.account_number;
      const address = typeof addressObject === 'string'
        ? addressObject
        : addressObject
          ? [addressObject.line1, addressObject.city, addressObject.postal_code, addressObject.country]
            .filter(Boolean)
            .join(', ')
          : req.body?.address;
      const country = receiving_bank_country || bank?.country || addressObject?.country || req.body?.country;
      const currency = supported_currency || req.body?.currency || 'EUR';
      const bankName = receiving_bank_name || bank?.bank_name || req.body?.bank_name;
      const effectiveSwift = receiving_bank_swift_bic || swift;
      if (!normalizedName || !(normalizedIban || accountNumber) || !(effectiveSwift || receiving_bank_routing_number || receiving_bank_sort_code || receiving_bank_local_clearing_code)) {
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'beneficiary legal name, account number or IBAN, and one supported bank identifier are required',
          code: 'BENE_INVALID',
        });
      }
      const id = uuidv4();
      const now = new Date().toISOString();
      const fullAddress = [
        beneficiary_address_line1,
        beneficiary_address_line2,
        beneficiary_city,
        beneficiary_country,
      ].filter(Boolean).join(', ') || address || null;
      const formMetadata = {
        ...(metadata || {}),
        beneficiaryAddressLine1: beneficiary_address_line1 || null,
        beneficiaryAddressLine2: beneficiary_address_line2 || null,
        beneficiaryCity: beneficiary_city || null,
        beneficiaryPhone: beneficiary_phone || null,
        receivingBankAddressLine1: receiving_bank_address_line1 || null,
        receivingBankAddressLine2: receiving_bank_address_line2 || null,
        receivingBankCity: receiving_bank_city || null,
        receivingBankCountry: receiving_bank_country || country || null,
        receivingBankRoutingNumber: receiving_bank_routing_number || null,
        receivingBankSortCode: receiving_bank_sort_code || null,
        receivingBankLocalClearingCode: receiving_bank_local_clearing_code || null,
        accountType: account_type || null,
        transferType: transfer_type || null,
        networkCode: network_code || null,
        paymentPurposeCode: payment_purpose_code || null,
        paymentDescription: payment_description || null,
        endToEndId: end_to_end_id || null,
        beneficiaryReference: beneficiary_reference || null,
        vaultCustomerId: vault_customer_id || null,
        vaultWalletId: vault_wallet_id || null,
        vaultCardReference: vault_card_reference || null,
        vaultSettlementBatchId: vault_settlement_batch_id || null,
        vaultTransactionId: vault_transaction_id || null,
        internalNote: internal_note || null,
      };
      await db.query(
        `INSERT INTO vault_beneficiaries
         (id, name, iban, swift, address, address_json, country, currency, bank_name, type, metadata, is_archived, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [
          id,
          normalizedName,
          normalizedIban || accountNumber,
          effectiveSwift || null,
          fullAddress,
          JSON.stringify({ line1: beneficiary_address_line1, line2: beneficiary_address_line2, city: beneficiary_city, country: beneficiary_country }),
          country || null,
          currency,
          bankName || null,
          type || 'corporate',
          JSON.stringify(formMetadata),
          now,
        ]
      );
      const sel = await db.query('SELECT * FROM vault_beneficiaries WHERE id = ?', [id]);
      res.status(201).json(sel.rows[0]);
    } catch (e: any) {
      console.error('[Vault:createBeneficiary]', e);
      res.status(500).json({ error: e.message || 'Failed to create beneficiary' });
    }
  }

  async createSepaDraft(req: Request, res: Response) {
    try {
      const {
        from_account_id,
        beneficiary_id,
        beneficiary,
        amount,
        currency,
        reference,
        internal_note,
        linked_payout_id,
        execution_date,
      } = req.body || {};

      if (!from_account_id || !amount) {
        return res.status(400).json({ error: 'from_account_id and amount are required' });
      }
      if (!beneficiary_id && !beneficiary) {
        return res.status(400).json({ error: 'beneficiary_id or beneficiary inline object is required' });
      }

      const id = uuidv4();
      const uetr = generateUetr();
      const now = new Date().toISOString();
      const safeReference = reference || `VAULT-SEPA-${id.slice(0, 8).toUpperCase()}`;

      let resolvedBeneficiaryId: string | null = beneficiary_id || null;
      let beneficiarySnapshot: any = null;

      if (beneficiary_id) {
        const ben = await db.query('SELECT * FROM vault_beneficiaries WHERE id = ?', [beneficiary_id]);
        if (ben.rows.length === 0) {
          return res.status(404).json({ error: 'Beneficiary not found' });
        }
        beneficiarySnapshot = ben.rows[0];
      } else if (beneficiary) {
        beneficiarySnapshot = beneficiary;
        resolvedBeneficiaryId = null;
      }

      const acc = await db.query('SELECT * FROM vault_accounts WHERE id = ?', [from_account_id]);
      if (acc.rows.length === 0) {
        return res.status(404).json({ error: 'From vault account not found' });
      }

      const accountBalance = Number(acc.rows[0].balance || 0);
      const reserved = Number(acc.rows[0].reserved_hold || 0);
      const available = accountBalance - reserved;
      if (Number(amount) > available) {
        return res.status(400).json({ error: 'Insufficient available balance in vault account' });
      }

      const resolvedCurrency = currency || acc.rows[0].currency || 'EUR';

      await db.query(
        `INSERT INTO vault_sepa_transfers
         (id, reference, from_account_id, beneficiary_id, beneficiary_snapshot, amount, currency, fee, status,
          uetr, internal_note, linked_payout_id, execution_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'DRAFT', ?, ?, ?, ?, ?, ?)`,
        [
          id, safeReference, from_account_id, resolvedBeneficiaryId,
          JSON.stringify(beneficiarySnapshot), Number(amount), resolvedCurrency,
          uetr, internal_note || null, linked_payout_id || null, execution_date || now.slice(0, 10),
          now, now,
        ]
      );

      const sel = await db.query('SELECT * FROM vault_sepa_transfers WHERE id = ?', [id]);
      const transfer = sel.rows[0];
      res.status(201).json({ transfer, uetr });
    } catch (e: any) {
      console.error('[Vault:createSepaDraft]', e);
      res.status(500).json({ error: e.message || 'Failed to create SEPA draft' });
    }
  }

  async executeSepaTransfer(req: Request, res: Response) {
    try {
      const { transfer_id, reference } = req.body || {};
      if (!transfer_id && !reference) {
        return res.status(400).json({ error: 'transfer_id or reference is required' });
      }

      let whereClause = '';
      const whereParams: any[] = [];
      if (transfer_id) {
        whereClause = 'id = ?';
        whereParams.push(transfer_id);
      } else {
        whereClause = 'reference = ?';
        whereParams.push(reference);
      }

      const sel = await db.query(`SELECT * FROM vault_sepa_transfers WHERE ${whereClause} LIMIT 1`, whereParams);
      if (sel.rows.length === 0) {
        return res.status(404).json({ error: 'Transfer not found' });
      }
      const transfer = sel.rows[0];

      if (transfer.status === 'SENT_TO_RAIL' || transfer.status === 'COMPLETED') {
        return res.status(400).json({ error: `Transfer already processed (status: ${transfer.status})` });
      }

      const fromAccount = await db.query('SELECT * FROM vault_accounts WHERE id = ?', [transfer.from_account_id]);
      if (fromAccount.rows.length === 0) {
        return res.status(404).json({ error: 'From vault account not found' });
      }
      const debtor = fromAccount.rows[0];

      let creditor = null;
      if (transfer.beneficiary_id) {
        const b = await db.query('SELECT * FROM vault_beneficiaries WHERE id = ?', [transfer.beneficiary_id]);
        creditor = b.rows[0] || null;
      }
      if (!creditor && transfer.beneficiary_snapshot) {
        try {
          creditor = typeof transfer.beneficiary_snapshot === 'string'
            ? JSON.parse(transfer.beneficiary_snapshot)
            : transfer.beneficiary_snapshot;
        } catch (_) { creditor = null; }
      }
      if (!creditor) {
        return res.status(400).json({ error: 'Cannot resolve beneficiary details for transfer' });
      }

      const now = new Date().toISOString();
      const uetr = transfer.uetr || generateUetr();
      const msgId = `VAULT${transfer.id.replace(/-/g, '').slice(0, 24).toUpperCase()}`;
      const downloadFilename = `PAIN001_ISO20022_SEPA_${transfer.currency}${Math.round(Number(transfer.amount))}_${msgId}_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.xml`;

      const debtorName = debtor.bank_name || 'Vault Settlement Account';
      const debtorBic = debtor.bic || 'PROCESSOR_BIC_PLACEHOLDER';
      const debtorIban = debtor.iban || 'PROCESSOR_IBAN_PLACEHOLDER';

      const xml = buildPain001Xml({
        msgId,
        createdAt: now,
        debtor: { name: debtorName, bic: debtorBic, iban: debtorIban },
        transactions: [{
          instrId: `INSTR-${transfer.id.slice(0, 16).toUpperCase()}`,
          endToEndId: transfer.reference,
          amount: Number(transfer.amount),
          currency: transfer.currency,
          creditorName: creditor.name || creditor.account_holder || 'Creditor',
          creditorIban: creditor.iban,
          creditorBic: creditor.swift || creditor.bic || 'UNKNOWNBIC',
          remittanceInfo: `SEPA Transfer ${transfer.reference} | Amount ${transfer.currency} ${Number(transfer.amount).toFixed(2)} | Internal note: ${transfer.internal_note || 'n/a'} | Vault Protocol 201.3`,
        }],
      });

      const settleDirName = `SETTLEMENT_VAULT_SEPA_${transfer.currency}${Math.round(Number(transfer.amount))}_${transfer.reference}_${transfer.id.slice(0, 8)}`;
      const settleDir = path.join(BACKEND_ROOT, settleDirName);
      if (!fs.existsSync(settleDir)) {
        fs.mkdirSync(settleDir, { recursive: true });
      }
      const xmlPath = path.join(settleDir, downloadFilename);
      fs.writeFileSync(xmlPath, xml, 'utf8');
      const relativeXmlPath = path.relative(BACKEND_ROOT, xmlPath);

      await db.query(
        `UPDATE vault_sepa_transfers
         SET status = 'SENT_TO_RAIL', sent_at = ?, uetr = ?, pain001_xml_path = ?, updated_at = ?
         WHERE id = ?`,
        [now, uetr, relativeXmlPath, now, transfer.id]
      );

      const finalSel = await db.query('SELECT * FROM vault_sepa_transfers WHERE id = ?', [transfer.id]);
      const finalTransfer = finalSel.rows[0];

      res.json({
        transfer: finalTransfer,
        pain001_xml_string: xml,
        uetr,
        download_filename: downloadFilename,
      });
    } catch (e: any) {
      console.error('[Vault:executeSepaTransfer]', e);
      res.status(500).json({ error: e.message || 'Failed to execute SEPA transfer' });
    }
  }

  async updateAccount(req: Request, res: Response) {
    try {
      const { id } = req.params as any;
      const updated = await vaultEngine.updateAccount(id, req.body || {});
      if (!updated) return res.status(404).json({ error: 'ACCOUNT_NOT_FOUND', message: 'Account not found' });
      res.json(updated);
    } catch (e: any) {
      console.error('[Vault:updateAccount]', e);
      res.status(500).json({ error: e.message || 'Failed to update account' });
    }
  }

  async listSepaTransfers(req: Request, res: Response) {
    try {
      const { status, currency, search } = req.query as any;
      const conditions: string[] = [];
      const params: any[] = [];

      if (status) {
        conditions.push('status = ?');
        params.push(status);
      }
      if (currency) {
        conditions.push('currency = ?');
        params.push(currency);
      }
      if (search) {
        conditions.push('(reference LIKE ? OR id LIKE ? OR internal_note LIKE ? OR linked_payout_id LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like, like);
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const sql = `SELECT * FROM vault_sepa_transfers ${where} ORDER BY created_at DESC LIMIT 500`;
      const result = await db.query(sql, params);
      res.json(result.rows);
    } catch (e: any) {
      console.error('[Vault:listSepaTransfers]', e);
      res.status(500).json({ error: e.message || 'Failed to list SEPA transfers' });
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // VAULT CARD ENDPOINTS
  // Luhn-valid settlement cards per vault account (PROC-VAULT-USD-002, etc.)
  // ═════════════════════════════════════════════════════════════════════════

  async issueVaultCard(req: Request, res: Response) {
    try {
      const vaultAccountId = String(req.body?.vault_account_id || req.body?.vaultAccountId || '').trim();
      if (!vaultAccountId) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'vault_account_id is required' });
      }
      const card = await issueVaultCardSvc(vaultAccountId);
      return res.status(201).json({
        ok: true,
        card,
        warning: 'CVV is shown once. Store securely — it cannot be retrieved later.',
      });
    } catch (e: any) {
      const code = e?.code || 'VAULT_CARD_FAILED';
      const status = code === 'BIN_NOT_DEFINED_FOR_VAULT' ? 400 : 500;
      return res.status(status).json({ error: code, message: e?.message || 'Vault card issuance failed' });
    }
  }

  async issueVaultBankCard(req: Request, res: Response) {
    try {
      const vaultAccountId = String(req.body?.vault_account_id || req.body?.vaultAccountId || '').trim();
      if (!vaultAccountId) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'vault_account_id is required' });
      }
      const card = await issueVaultBankCardSvc(vaultAccountId);
      return res.status(201).json({
        ok: true,
        card,
        warning: 'CVV is shown once. Store securely — it cannot be retrieved later.',
      });
    } catch (e: any) {
      return res.status(500).json({ error: e?.code || 'VAULT_CARD_FAILED', message: e?.message || 'Vault bank card issuance failed' });
    }
  }

  async listVaultCards(req: Request, res: Response) {
    try {
      const vaultAccountId = req.query.vault_account_id
        ? String(req.query.vault_account_id)
        : undefined;
      const cards: VaultCard[] = vaultAccountId
        ? await getVaultCardsByAccount(vaultAccountId)
        : await getAllVaultCards();
      return res.json({ ok: true, count: cards.length, cards });
    } catch (e: any) {
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || 'Failed to list vault cards' });
    }
  }

  async getVaultCard(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const card = await getVaultCardById(id);
      if (!card) return res.status(404).json({ error: 'NOT_FOUND', message: 'Vault card not found' });
      return res.json({ ok: true, card });
    } catch (e: any) {
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || 'Failed to load vault card' });
    }
  }

  async getActiveVaultCard(req: Request, res: Response) {
    try {
      const vaultAccountId = String(req.params.vaultAccountId || req.params.accountId || '').trim();
      if (!vaultAccountId) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'vault account id is required' });
      const card = await getActiveVaultCardByAccount(vaultAccountId);
      if (!card) return res.status(404).json({ error: 'NOT_FOUND', message: 'No active vault card for this account' });
      return res.json({ ok: true, card });
    } catch (e: any) {
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || 'Failed to load active vault card' });
    }
  }

  async updateVaultCardStatus(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const status = String(req.body?.status || '').toUpperCase().trim();
      if (!['ACTIVE', 'SUSPENDED', 'TERMINATED'].includes(status)) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'status must be ACTIVE, SUSPENDED, or TERMINATED' });
      }
      const updated = await updateVaultCardStatus(id, status as 'ACTIVE' | 'SUSPENDED' | 'TERMINATED');
      if (!updated) return res.status(404).json({ error: 'NOT_FOUND', message: 'Vault card not found' });
      return res.json({ ok: true, id, status });
    } catch (e: any) {
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: e?.message || 'Failed to update vault card status' });
    }
  }

  async networkAuthVaultCard(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const amountMinor = Number(req.body?.amountMinor ?? req.body?.amount_minor ?? 0);
      const currency = String(req.body?.currency || 'USD').toUpperCase();
      const merchantAccount = req.body?.merchantAccount || req.body?.merchant_account || 'VAULT-API-MID';
      const terminalId = req.body?.terminalId || req.body?.terminal_id || 'VAULT-API-001';

      if (!amountMinor || amountMinor <= 0) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'amountMinor (positive integer minor units) is required' });
      }
      const result = await generateVaultCardNetworkAuth({
        vaultCardId: id,
        amountMinor,
        currency,
        merchantAccount,
        terminalId,
      });
      return res.json({ ok: result.success, ...result });
    } catch (e: any) {
      const code = e?.code || e?.name || 'NETWORK_AUTH_FAILED';
      const status = code === 'VAULT_CARD_NOT_FOUND' || code === 'VAULT_CARD_NOT_ACTIVE'
        ? 404 : (code.startsWith('INVALID_') || code === 'LUHN_CHECK_FAILED' || code === 'VAULT_CARD_OR_ID_REQUIRED') ? 400 : 502;
      return res.status(status).json({ ok: false, error: code, message: e?.message || String(e) });
    }
  }

  async networkAuthVaultCardByPan(req: Request, res: Response) {
    try {
      const cardNumber = String(req.body?.card_number || req.body?.cardNumber || req.body?.pan || '').replace(/\D/g, '');
      const expiry = String(req.body?.expiry || req.body?.expiration || '');
      const cvv = String(req.body?.cvv || req.body?.cvc || '');
      const amountMinor = Number(req.body?.amountMinor ?? req.body?.amount_minor ?? 0);
      const currency = String(req.body?.currency || 'USD').toUpperCase();

      if (!cardNumber || cardNumber.length < 13) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'card_number (13-19 digits) is required' });
      }
      if (!amountMinor || amountMinor <= 0) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'amountMinor (positive integer minor units) is required' });
      }
      const result = await generateVaultCardNetworkCodes(cardNumber, expiry, cvv, amountMinor, currency, {
        merchantAccount: req.body?.merchantAccount || req.body?.merchant_account,
        terminalId: req.body?.terminalId || req.body?.terminal_id,
      });
      return res.json({ ok: result.success, ...result });
    } catch (e: any) {
      const code = e?.code || 'NETWORK_AUTH_FAILED';
      const status = (code.startsWith('INVALID_') || code === 'LUHN_CHECK_FAILED') ? 400 : 502;
      return res.status(status).json({ ok: false, error: code, message: e?.message || String(e) });
    }
  }
}

export const vaultController = new VaultController();
