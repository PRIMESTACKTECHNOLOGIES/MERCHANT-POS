import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import { authenticateToken } from '../../middleware/auth.middleware';
import { vaultBankService } from './vaultBank.service';
import { generateVaultApiKey, generateVaultSecretKey } from './gateway/auth/apiKey';
import { vaultController } from './vault.controller';
import { transferMerchantFundsToVault } from './merchantVaultTransfer.service';
import {
  sendToAbsa,
  getAbsaBalance,
  getAbsaTransferStatus,
  getAbsaTransactions,
  handleAbsaIncomingCredit,
  verifyAbsaWebhook,
} from './absaBank.service';
import crypto from 'crypto';
import { custodyReserveEngine } from './custodyReserve.service';

const router = Router();

router.get('/accounts', vaultController.getAccounts.bind(vaultController));
router.get('/controlled/accounts', vaultController.listControlledAccounts.bind(vaultController));
router.post('/accounts', vaultController.createControlledAccount.bind(vaultController));
router.get('/controlled/accounts/:id/reconciliation', vaultController.controlledReconciliation.bind(vaultController));
router.get('/controlled/accounts/:id/entries', vaultController.controlledEntries.bind(vaultController));
router.get('/controlled/accounts/:id/events', vaultController.controlledEvents.bind(vaultController));
router.patch('/accounts/:id', vaultController.updateAccount.bind(vaultController));
router.get('/stats', vaultController.getStats.bind(vaultController));
router.get('/provider-funds', vaultController.getProviderFunds.bind(vaultController));
router.get('/transfers', vaultController.getTransfers.bind(vaultController));
router.get('/batch-settlements', vaultController.getBatchSettlements.bind(vaultController));
router.get('/payouts', vaultController.getPayouts.bind(vaultController));
router.post('/payouts', vaultController.createControlledPayout.bind(vaultController));
router.post('/payouts/:id/confirm', vaultController.confirmControlledPayout.bind(vaultController));
router.post('/payouts/:id/fail', vaultController.failControlledPayout.bind(vaultController));
router.post('/entries/credit', vaultController.creditControlledAccount.bind(vaultController));
router.post('/credit', vaultController.creditVault.bind(vaultController));
router.post('/debit', vaultController.debitVault.bind(vaultController));
router.post('/merchant-transfer', async (req, res) => {
  try {
    return res.status(201).json(await transferMerchantFundsToVault({
      merchantId: req.body?.merchantId || req.body?.merchant_id,
      amount: req.body?.amount,
      currency: req.body?.currency,
      reference: req.body?.reference,
    }));
  } catch (error: any) {
    const status = error?.code === 'VALIDATION_ERROR' ? 400 : error?.code === 'NO_FUNDS' ? 409 : error?.code === 'TRANSFER_IN_PROGRESS' ? 409 : 502;
    return res.status(status).json({ error: error?.code || 'VAULT_TRANSFER_FAILED', message: error?.message || 'Vault transfer failed' });
  }
});
router.get('/balance', vaultController.getVaultBalance.bind(vaultController));
router.get('/ledger', vaultController.getVaultLedger.bind(vaultController));
router.get('/reconciliation', vaultController.getReconciliation.bind(vaultController));
router.get('/liquidity', vaultController.getLiquidity.bind(vaultController));
router.get('/liquidity/log', vaultController.getLiquidityLog.bind(vaultController));
router.get('/real-funds', async (_req, res) => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS vault_real_funds (
        id TEXT PRIMARY KEY,
        currency TEXT NOT NULL,
        confirmed_amount REAL NOT NULL,
        available_amount REAL NOT NULL,
        external_reference TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        confirmed_at TEXT NOT NULL
      )
    `);
    const rows = (await db.query(
      `SELECT currency, COALESCE(SUM(confirmed_amount), 0) AS confirmed,
              COALESCE(SUM(available_amount), 0) AS available
         FROM vault_real_funds
        WHERE source = 'signed-bank-webhook'
        GROUP BY currency
        ORDER BY currency`,
    )).rows;
    return res.json({ currencies: rows });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to load confirmed real funds' });
  }
});
router.get('/custody-reserve/:currency', authenticateToken, async (req, res) => {
  try {
    const summary = await custodyReserveEngine.getSummary(req.params.currency);
    // If the custody ledger has never been credited (all zeros), fall back to
    // vault_accounts so the UI shows the real operational balance instead of 0.00
    if (summary.available === 0 && summary.pending === 0 && summary.settled === 0) {
      const ccy = String(req.params.currency).toUpperCase();
      const vaultRow = await db.query(
        'SELECT balance, available_balance, pending_settlement FROM vault_accounts WHERE currency = ? LIMIT 1',
        [ccy]
      );
      if (vaultRow.rows?.[0]) {
        const row = vaultRow.rows[0] as any;
        const balance   = Number(row.balance            || 0);
        const available = Number(row.available_balance  || 0) || balance;
        const pending   = Number(row.pending_settlement || 0);
        return res.json({ ...summary, available, pending, settled: balance, source: 'vault_accounts' });
      }
    }
    return res.json(summary);
  } catch (error: any) {
    return res.status(error?.code === 'VALIDATION_ERROR' ? 400 : 500).json({ error: error?.code || 'INTERNAL_ERROR', message: error?.message || 'Failed to load custody reserve' });
  }
});
router.get('/custody-reserve/:currency/entries', authenticateToken, async (req, res) => {
  try {
    return res.json({ entries: await custodyReserveEngine.listEntries(req.params.currency) });
  } catch (error: any) {
    return res.status(error?.code === 'VALIDATION_ERROR' ? 400 : 500).json({ error: error?.code || 'INTERNAL_ERROR', message: error?.message || 'Failed to load custody reserve entries' });
  }
});
router.post('/custody-reserve/withdrawals', authenticateToken, async (req, res) => {
  try {
    return res.status(201).json(await custodyReserveEngine.createWithdrawal({
      currency: req.body?.currency,
      amount: req.body?.amount,
      beneficiary: req.body?.beneficiary,
      externalReference: req.body?.externalReference,
    }));
  } catch (error: any) {
    const status = error?.code === 'NO_FUNDS' ? 409 : error?.code === 'VALIDATION_ERROR' ? 400 : 500;
    return res.status(status).json({ error: error?.code || 'INTERNAL_ERROR', message: error?.message || 'Failed to create custody withdrawal' });
  }
});
router.post('/custody-reserve/withdrawals/:id/settle', authenticateToken, async (req, res) => {
  try {
    return res.json(await custodyReserveEngine.settleWithdrawal(req.params.id, String(req.body?.providerReference || '')));
  } catch (error: any) {
    const status = error?.code === 'NOT_FOUND' ? 404 : error?.code === 'VALIDATION_ERROR' ? 400 : error?.code === 'INVALID_STATE' ? 409 : 500;
    return res.status(status).json({ error: error?.code || 'INTERNAL_ERROR', message: error?.message || 'Failed to settle custody withdrawal' });
  }
});
router.post('/custody-reserve/withdrawals/:id/release', authenticateToken, async (req, res) => {
  try {
    return res.json(await custodyReserveEngine.releaseWithdrawal(req.params.id));
  } catch (error: any) {
    const status = error?.code === 'NOT_FOUND' ? 404 : error?.code === 'INVALID_STATE' ? 409 : 500;
    return res.status(status).json({ error: error?.code || 'INTERNAL_ERROR', message: error?.message || 'Failed to release custody withdrawal' });
  }
});
router.post('/custody-reserve/crypto-purchases', authenticateToken, async (req, res) => {
  let hold: { holdId: string; externalReference: string; currency: string; amount: number } | null = null;
  try {
    const customerId = String(req.body?.customerId || req.body?.customer_id || '').trim();
    const asset = String(req.body?.asset || req.body?.cryptoCurrency || '').toUpperCase().trim();
    const amount = Number(req.body?.amount || req.body?.amountUsd);
    const currency = String(req.body?.currency || 'USD').toUpperCase();
    const network = req.body?.network ? String(req.body.network) : undefined;
    if (!customerId || !asset || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'customerId, asset, and positive amount are required' });
    }
    hold = await custodyReserveEngine.createCryptoHold({ currency, amount, customerId, asset, network });
    if (!hold) throw new Error('Custody reserve hold was not created');
    const activeHold = hold;
    const xr = await import('../../exchange/exchange-router.service');
    const order = await xr.buyAssetBestEffort(asset, amount);
    if (!order?.ok || Number(order.executedQty || 0) <= 0) throw new Error('Crypto provider did not confirm an executed purchase');
    const wallets = await import('../wallets/wallets.service');
    const wallet = await wallets.walletsService.getOrCreateCryptoWallet(customerId, asset);
    await db.query('UPDATE customer_crypto_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [Number(order.executedQty), wallet.id]);
    const providerReference = String(order.order_id || `CRYPTO-${hold.holdId}`);
    await custodyReserveEngine.settleCryptoHold(activeHold.holdId, providerReference);
    return res.json({ ok: true, status: 'CONFIRMED', holdId: activeHold.holdId, providerReference, customerId, asset, amount, currency, cryptoAmount: Number(order.executedQty), reserve: await custodyReserveEngine.getSummary(currency) });
  } catch (error: any) {
    if (hold) {
      try { await custodyReserveEngine.releaseCryptoHold(hold.holdId); } catch { /* preserve purchase error */ }
    }
    const status = error?.code === 'NO_FUNDS' ? 409 : error?.code === 'VALIDATION_ERROR' ? 400 : 502;
    return res.status(status).json({ error: error?.code || 'CRYPTO_PURCHASE_FAILED', message: error?.message || 'Custody reserve crypto purchase failed' });
  }
});
router.get('/audit', vaultController.getAudit.bind(vaultController));
router.get('/audit/verify', vaultController.verifyAudit.bind(vaultController));
router.get('/audit/events', vaultController.getAudit.bind(vaultController));
router.get('/audit/merchant/:merchantId', (req, res) => {
  req.query.merchantId = req.params.merchantId;
  return vaultController.getAudit(req, res);
});
router.get('/audit/:id', vaultController.getAuditEntry.bind(vaultController));

router.get('/security/api-key', async (_req, res) => {
  try {
    const result = await db.query(
      'SELECT api_key, label, active, created_at, last_used_at FROM vault_api_keys WHERE active = 1 ORDER BY created_at DESC LIMIT 1',
    );
    const key = result.rows[0];
    if (!key) return res.status(404).json({ error: 'NOT_FOUND', message: 'No active vault API key configured' });
    const apiKey = String(key.api_key);
    return res.json({
      apiKey: `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`,
      transferUrl: process.env.VAULT_BANK_TRANSFER_URL?.trim()
        || `http://127.0.0.1:${process.env.VAULT_BANK_PORT || '9001'}/api/vault/settlement`,
      secretConfigured: Boolean(process.env.VAULT_BANK_SECRET_KEY?.trim()),
      label: key.label || 'Vault gateway',
      active: Boolean(key.active),
      createdAt: key.created_at,
      lastUsedAt: key.last_used_at,
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: error?.message || 'Failed to load API key status' });
  }
});

router.get('/security/api-key/reveal', authenticateToken, async (_req, res) => {
  try {
    const result = await db.query(
      'SELECT api_key, label, active, created_at, last_used_at FROM vault_api_keys WHERE active = 1 ORDER BY created_at DESC LIMIT 1',
    );
    const key = result.rows[0];
    if (!key) return res.status(404).json({ error: 'NOT_FOUND', message: 'No active vault API key configured' });
    return res.json({
      apiKey: String(key.api_key),
      label: key.label || 'Vault gateway',
      active: Boolean(key.active),
      createdAt: key.created_at,
      lastUsedAt: key.last_used_at,
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: error?.message || 'Failed to reveal API key' });
  }
});

router.get('/security/card-details', authenticateToken, async (_req, res) => {
  const cards = [
    {
      id: 'usd',
      cardholderName: process.env.VAULT_CARDHOLDER_NAME?.trim() || 'AJI ALOSIOUS',
      cardNumber: process.env.VAULT_CARD_PAN?.trim(),
      expiry: process.env.VAULT_CARD_EXPIRY?.trim() || '05/30',
      cvv: process.env.VAULT_CARD_CVV?.trim(),
      currency: 'USD',
    },
    {
      id: 'eur',
      cardholderName: process.env.VAULT_EUR_CARDHOLDER_NAME?.trim() || 'DANIA ALOSIOUS',
      cardNumber: process.env.VAULT_EUR_CARD_PAN?.trim(),
      expiry: process.env.VAULT_EUR_CARD_EXPIRY?.trim() || '06/29',
      cvv: process.env.VAULT_EUR_CARD_CVV?.trim(),
      currency: 'EUR',
    },
  ];
  if (cards.some((card) => !card.cardNumber || !card.cvv)) {
    return res.status(404).json({
      error: 'NOT_CONFIGURED',
      message: 'Vault card details are not configured in the server environment',
    });
  }
  return res.json({ cards });
});

router.post('/security/api-key/rotate', async (req, res) => {
  try {
    const current = await db.query('SELECT api_key FROM vault_api_keys WHERE active = 1 LIMIT 1');
    const apiKey = generateVaultApiKey();
    const secretKey = generateVaultSecretKey();
    const createdAt = new Date().toISOString();
    await db.query('UPDATE vault_api_keys SET active = 0 WHERE active = 1');
    await db.query(
      `INSERT INTO vault_api_keys (id, api_key, secret_key, label, active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [uuidv4(), apiKey, secretKey, String(req.body?.label || 'Vault gateway'), createdAt],
    );
    return res.status(201).json({
      apiKey,
      secretKey,
      previousKeyRevoked: current.rows.length > 0,
      warning: 'Store the secret securely. It is shown once and is not returned again.',
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: error?.message || 'Failed to rotate API key' });
  }
});

router.post('/reserve/create', vaultController.createReserve.bind(vaultController));
router.post('/reserve/release', vaultController.releaseReserve.bind(vaultController));
router.post('/reserve/cancel', vaultController.cancelReserve.bind(vaultController));
router.get('/reserve/list', vaultController.listReserves.bind(vaultController));

router.get('/beneficiaries', vaultController.getBeneficiaries.bind(vaultController));
router.post('/beneficiaries', vaultController.createBeneficiary.bind(vaultController));

router.post('/sepa/draft', vaultController.createSepaDraft.bind(vaultController));
router.post('/sepa/execute', vaultController.executeSepaTransfer.bind(vaultController));
router.get('/sepa/transfers', vaultController.listSepaTransfers.bind(vaultController));

// ── POST /api/vault/card-load ────────────────────────────────────────────────
// Load funds from the vault onto a card (operator-controlled).
// Debits vault account, records the load in vault_card_loads table.
// Body: { currency, amount, cardLabel?, note? }
router.post('/card-load', async (_req, res) => {
  return res.status(410).json({
    error: 'EXTERNAL_PROVIDER_REQUIRED',
    message: 'Vault cards accept loads only from a confirmed external real-funds provider.',
  });
});

router.post('/card-load/external', async (req, res) => {
  try {
    const {
      endpoint, apiKey, providerName, providerAccount, environment,
      sourceReference, cardId, currency, amount, note, fundingMethod, sourceDetails,
    } = req.body || {};
    const ccy = String(currency || '').toUpperCase().trim();
    const amt = Number(amount);
    const methods = ['card-to-card', 'server-to-card', 'bank-to-card', 'wallet-to-card'];
    const normalizedCardId = String(cardId).toLowerCase();
    const cardCurrency = normalizedCardId === 'usd' ? 'USD' : normalizedCardId === 'eur' ? 'EUR' : '';
    if (!methods.includes(String(fundingMethod)) || !endpoint || !apiKey || !providerName || !providerAccount || !sourceReference || !cardCurrency || !ccy || ccy !== cardCurrency || !Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'providerName, providerAccount, endpoint, apiKey, sourceReference, cardId, currency, and positive amount are required' });
    }
    const routeMissing = fundingMethod === 'card-to-card'
      ? !sourceDetails?.sourceCardReference
      : fundingMethod === 'server-to-card'
        ? !sourceDetails?.sourceServerReference || !sourceDetails?.sourceServerName || !sourceDetails?.sourceServerAccount
        : fundingMethod === 'bank-to-card'
          ? !sourceDetails?.sourceBankReference || !sourceDetails?.sourceBankName || !sourceDetails?.sourceBankSenderName
          : !sourceDetails?.sourceWalletId || !sourceDetails?.sourceWalletNetwork || !sourceDetails?.sourceWalletTransactionId;
    if (routeMissing) {
      return res.status(400).json({
        error: `All required source details are required for ${fundingMethod}`,
      });
    }
    const transferTypes = ['SWIFT', 'SEPA', 'DOMESTIC', 'ACH', 'RTGS', 'IMPS', 'PIX', 'FASTER_PAYMENTS', 'FEDWIRE'];
    if (fundingMethod === 'bank-to-card' && (!transferTypes.includes(String(sourceDetails?.transferType || '').toUpperCase()) || (sourceDetails?.transferNetworkCode && !/^[A-Z0-9][A-Z0-9 _-]{1,31}$/i.test(String(sourceDetails.transferNetworkCode))))) {
      return res.status(400).json({ error: 'A supported transfer type and valid transfer network code are required for bank-to-card' });
    }
    const target = new URL(String(endpoint));
    if (target.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(target.hostname)) {
      return res.status(400).json({ error: 'External load endpoint must use HTTPS' });
    }
    const allowedHosts = String(process.env.VAULT_EXTERNAL_LOAD_ALLOWED_HOSTS || '')
      .split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
    if (allowedHosts.length && !allowedHosts.includes(target.hostname.toLowerCase())) {
      return res.status(403).json({ error: 'External load endpoint is not allowlisted' });
    }
    const requestReference = uuidv4();
    const payload = {
      fundingMethod,
      cardId: normalizedCardId,
      currency: ccy,
      amount: amt,
      providerName: String(providerName),
      providerAccount: String(providerAccount),
      environment: environment === 'sandbox' ? 'sandbox' : 'production',
      sourceReference: String(sourceReference),
      sourceDetails: sourceDetails || {},
      note: note ? String(note) : undefined,
      reference: requestReference,
    };
    const body = JSON.stringify(payload);
    const secret = String(process.env.VAULT_EXTERNAL_LOAD_HMAC_SECRET || '').trim();
    if (!secret) return res.status(503).json({ error: 'External load signing is not configured on the server' });
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const upstream = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': String(apiKey), 'X-SIGNATURE': signature }, body, signal: AbortSignal.timeout(15000) });
    const responseBody = await upstream.json().catch(() => ({}));
    const confirmedAmount = Number(responseBody.settledMinor ?? responseBody.confirmedAmount ?? responseBody.amount);
    const confirmedCurrency = String(responseBody.currency || ccy).toUpperCase();
    const requestedTransferType = fundingMethod === 'bank-to-card' ? String(sourceDetails?.transferType || '').toUpperCase() : null;
    const confirmedTransferType = responseBody.transferType ? String(responseBody.transferType).toUpperCase() : null;
    if (!upstream.ok || responseBody.status !== 'CONFIRMED' || !Number.isFinite(confirmedAmount) || confirmedAmount !== amt || confirmedCurrency !== ccy || (requestedTransferType && confirmedTransferType && requestedTransferType !== confirmedTransferType)) {
      return res.status(502).json({ error: responseBody.message || 'External provider did not confirm the card load' });
    }
    const providerReference = responseBody.providerReference || responseBody.settlementId || responseBody.transferId || null;
    const reserve = await custodyReserveEngine.creditExternalFunds({
      currency: ccy,
      amount: amt,
      externalReference: String(sourceReference),
      providerReference,
      providerName: String(providerName),
      providerAccount: String(providerAccount),
      cardId: normalizedCardId,
      fundingMethod: String(fundingMethod),
      metadata: {
        requestReference,
        transferType: fundingMethod === 'bank-to-card' ? String(sourceDetails?.transferType || '').toUpperCase() : undefined,
        transferNetworkCode: fundingMethod === 'bank-to-card' && sourceDetails?.transferNetworkCode
          ? String(sourceDetails.transferNetworkCode).toUpperCase()
          : undefined,
      },
    });
    const loadId = uuidv4();
    const now = new Date().toISOString();
    await db.query(`CREATE TABLE IF NOT EXISTS vault_card_loads (
      id TEXT PRIMARY KEY, vault_account_id TEXT NOT NULL, currency TEXT NOT NULL,
      amount REAL NOT NULL, card_label TEXT, note TEXT,
      status TEXT NOT NULL DEFAULT 'LOADED', loaded_at TEXT NOT NULL,
      funding_method TEXT, provider_name TEXT, provider_account TEXT,
      source_reference TEXT, provider_reference TEXT, request_reference TEXT,
      transfer_type TEXT, transfer_network_code TEXT
    )`);
    const columns = (await db.query(`PRAGMA table_info(vault_card_loads)`)).rows.map((row: any) => String(row.name));
    const migrations: Array<[string, string]> = [
      ['funding_method', 'TEXT'], ['provider_name', 'TEXT'], ['provider_account', 'TEXT'],
      ['source_reference', 'TEXT'], ['provider_reference', 'TEXT'], ['request_reference', 'TEXT'],
      ['transfer_type', 'TEXT'], ['transfer_network_code', 'TEXT'],
    ];
    for (const [name, type] of migrations) {
      if (!columns.includes(name)) await db.query(`ALTER TABLE vault_card_loads ADD COLUMN ${name} ${type}`);
    }
    await db.query(
      `INSERT INTO vault_card_loads
        (id, vault_account_id, currency, amount, card_label, note, status, loaded_at,
         funding_method, provider_name, provider_account, source_reference, provider_reference,
         request_reference, transfer_type, transfer_network_code)
       VALUES (?, ?, ?, ?, ?, ?, 'LOADED', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        loadId, 'EXTERNAL_PROVIDER', ccy, amt, String(cardId),
        note ? String(note) : `External reference: ${sourceReference}`, now,
        String(fundingMethod), String(providerName), String(providerAccount),
        String(sourceReference), providerReference, requestReference,
        fundingMethod === 'bank-to-card' ? String(sourceDetails?.transferType || '').toUpperCase() : null,
        fundingMethod === 'bank-to-card' ? (sourceDetails?.transferNetworkCode ? String(sourceDetails.transferNetworkCode).toUpperCase() : null) : null,
      ],
    );
    return res.json({ ok: true, status: 'CONFIRMED', loadId, cardId, currency: ccy, amount: amt, providerReference, reserve, provider: responseBody });
  } catch (e: any) {
    return res.status(502).json({ error: e?.message || 'External card load failed' });
  }
});
// ── GET /api/vault/card-loads ─────────────────────────────────────────────────
// Returns history of all card loads from the vault.
router.get('/card-loads', async (_req, res) => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS vault_card_loads (
        id TEXT PRIMARY KEY, vault_account_id TEXT NOT NULL,
        currency TEXT NOT NULL, amount REAL NOT NULL,
        card_label TEXT, note TEXT,
        status TEXT NOT NULL DEFAULT 'LOADED', loaded_at TEXT NOT NULL
      )
    `);
    const rows = (await db.query(
      'SELECT * FROM vault_card_loads ORDER BY loaded_at DESC LIMIT 100'
    )).rows;
    return res.json({ ok: true, loads: rows, count: rows.length });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});


// ════════════════════════════════════════════════════════════════════════════
// VAULT BANK SERVICE ENDPOINTS
// Real fund collection, balance, payouts, reconciliation, entries
// ════════════════════════════════════════════════════════════════════════════

// ── POST /api/vault/deposits ─────────────────────────────────────────────────
router.post('/vault-bank/deposits', authenticateToken, async (req, res) => {
  const idemKey = req.headers['idempotency-key'] as string | undefined;
  if (idemKey) {
    const cached = await vaultBankService.checkIdempotency(idemKey);
    if (cached) return res.json({ ...cached, idempotent: true });
  }
  try {
    const { accountId, amount, currency, reference, source } = req.body || {};
    if (!accountId || !amount || !currency) {
      return res.status(400).json({ ok: false, error: 'accountId, amount, and currency are required' });
    }
    const result = await vaultBankService.deposit(accountId, Number(amount), currency, reference || '', source);
    if (idemKey) await vaultBankService.storeIdempotency(idemKey, result);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /api/vault/balance/:accountId ────────────────────────────────────────
router.get('/vault-bank/balance/:accountId', authenticateToken, async (req, res) => {
  try {
    const { accountId } = req.params;
    const currency = (req.query.currency as string) || 'USD';
    const result = await vaultBankService.getBalance(accountId, currency);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /api/vault/payouts ───────────────────────────────────────────────────
router.post('/vault-bank/payouts', authenticateToken, async (req, res) => {
  const idemKey = req.headers['idempotency-key'] as string | undefined;
  if (idemKey) {
    const cached = await vaultBankService.checkIdempotency(idemKey);
    if (cached) return res.json({ ...cached, idempotent: true });
  }
  try {
    const { accountId, amount, currency, beneficiaryName, beneficiaryIban, beneficiaryRouting, beneficiarySwift, reference } = req.body || {};
    if (!accountId || !amount || !beneficiaryName) {
      return res.status(400).json({ ok: false, error: 'accountId, amount, and beneficiaryName are required' });
    }
    if (!beneficiaryIban && !beneficiaryRouting) {
      return res.status(400).json({ ok: false, error: 'Either beneficiaryIban or beneficiaryRouting is required' });
    }
    const result = await vaultBankService.createPayout({ accountId, amount: Number(amount), currency, beneficiaryName, beneficiaryIban, beneficiaryRouting, beneficiarySwift, reference });
    if (idemKey) await vaultBankService.storeIdempotency(idemKey, result);
    return res.json(result);
  } catch (e: any) {
    const status = e.code === 'INSUFFICIENT_FUNDS' ? 400 : 500;
    return res.status(status).json({ ok: false, error: e.message });
  }
});

// ── GET /api/vault/reconcile/:accountId/daily ────────────────────────────────
router.get('/vault-bank/reconcile/:accountId/daily', authenticateToken, async (req, res) => {
  try {
    const { accountId } = req.params;
    const date = req.query.date as string | undefined;
    const result = await vaultBankService.getDailyReconciliation(accountId, date);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /api/vault/entries/:accountId ────────────────────────────────────────
router.get('/vault-bank/entries/:accountId', authenticateToken, async (req, res) => {
  try {
    const { accountId } = req.params;
    const currency = req.query.currency as string | undefined;
    const limit    = parseInt(req.query.limit as string || '50', 10);
    const entries  = await vaultBankService.getEntries(accountId, currency, limit);
    return res.json({ ok: true, accountId, count: entries.length, entries });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /api/vault/webhook/sign — sign a payload for delivery ───────────────
router.post('/vault-bank/webhook/sign', authenticateToken, async (req, res) => {
  try {
    const { payload, secret } = req.body || {};
    if (!payload || !secret) return res.status(400).json({ ok: false, error: 'payload and secret are required' });
    const sig = vaultBankService.signWebhook(payload, secret);
    return res.json({ ok: true, ...sig });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /api/vault/webhook/verify ───────────────────────────────────────────
router.post('/vault-bank/webhook/verify', authenticateToken, async (req, res) => {
  try {
    const { payload, secret, timestamp, signature } = req.body || {};
    if (!payload || !secret || !timestamp || !signature) {
      return res.status(400).json({ ok: false, error: 'payload, secret, timestamp, and signature are required' });
    }
    const valid = vaultBankService.verifyWebhook(payload, secret, Number(timestamp), signature);
    return res.json({ ok: true, valid });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /api/vault/provider-connect-test ─────────────────────────────────────
// Tests connectivity to an external provider endpoint using the given credentials.
// Body: { endpointUrl, apiKey, secretKey }
router.post('/provider-connect-test', authenticateToken, async (req, res) => {
  try {
    const { endpointUrl, apiKey, secretKey } = req.body || {};
    if (!endpointUrl) return res.status(400).json({ ok: false, error: 'endpointUrl is required' });
    if (!apiKey) return res.status(400).json({ ok: false, error: 'apiKey is required' });

    const https = await import('https');
    const http = await import('http');
    const url = new URL(endpointUrl);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const testResult = await new Promise<{ ok: boolean; status: number; body: string }>((resolve) => {
      const opts = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + (url.search || ''),
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'X-Secret-Key': secretKey || '',
          'Content-Type': 'application/json',
          'X-Processor-Id': 'PRIMESTACK-B4C329F83258',
        },
        timeout: 8000,
      };
      const reqNode = (client as any).request(opts, (resNode: any) => {
        let data = '';
        resNode.on('data', (c: any) => { data += c; });
        resNode.on('end', () => resolve({ ok: resNode.statusCode < 500, status: resNode.statusCode, body: data.slice(0, 200) }));
      });
      reqNode.on('error', (e: any) => resolve({ ok: false, status: 0, body: e.message }));
      reqNode.on('timeout', () => { reqNode.destroy(); resolve({ ok: false, status: 0, body: 'Connection timed out' }); });
      reqNode.end();
    });

    if (testResult.ok) {
      return res.json({ ok: true, message: 'Connection successful', status: testResult.status, providerResponse: testResult.body });
    } else {
      return res.status(400).json({ ok: false, error: `Provider returned status ${testResult.status}`, detail: testResult.body });
    }
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /api/vault/provider-transfer ─────────────────────────────────────────
// Calls the external provider to pull funds, then credits vault bank ledger.
// Body: { endpointUrl, apiKey, secretKey, merchantId, amount, currency, reference? }
router.post('/provider-transfer', authenticateToken, async (req, res) => {
  try {
    const { endpointUrl, apiKey, secretKey, merchantId, amount, currency, reference } = req.body || {};
    if (!endpointUrl || !apiKey || !merchantId || !amount || !currency) {
      return res.status(400).json({ ok: false, error: 'endpointUrl, apiKey, merchantId, amount, currency are required' });
    }
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ ok: false, error: 'amount must be positive' });
    const ccy = String(currency).toUpperCase();
    const ref = reference || `PVDR-${Date.now().toString(36).toUpperCase()}`;

    // Call external provider to confirm/pull funds
    const https = await import('https');
    const http = await import('http');
    const { v4: uuid } = await import('uuid');
    const url = new URL(endpointUrl);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const body = JSON.stringify({ merchantId, amount: amt, currency: ccy, reference: ref, action: 'pull_funds', processorId: 'PRIMESTACK-B4C329F83258' });

    const providerResult = await new Promise<{ ok: boolean; status: number; data: any }>((resolve) => {
      const opts = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + (url.search || ''),
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'X-Secret-Key': secretKey || '',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Processor-Id': 'PRIMESTACK-B4C329F83258',
          'X-Reference': ref,
        },
        timeout: 15000,
      };
      const reqNode = (client as any).request(opts, (resNode: any) => {
        let d = '';
        resNode.on('data', (c: any) => { d += c; });
        resNode.on('end', () => {
          try { resolve({ ok: resNode.statusCode < 300, status: resNode.statusCode, data: JSON.parse(d) }); }
          catch { resolve({ ok: resNode.statusCode < 300, status: resNode.statusCode, data: { raw: d.slice(0, 200) } }); }
        });
      });
      reqNode.on('error', (e: any) => resolve({ ok: false, status: 0, data: { error: e.message } }));
      reqNode.on('timeout', () => { reqNode.destroy(); resolve({ ok: false, status: 0, data: { error: 'Provider timed out' } }); });
      reqNode.write(body);
      reqNode.end();
    });

    if (!providerResult.ok) {
      return res.status(400).json({ ok: false, error: `Provider rejected transfer (HTTP ${providerResult.status})`, detail: providerResult.data });
    }

    // Provider confirmed — credit vault bank ledger
    const accountId = ccy === 'EUR' ? 'PROC-VAULT-EUR-001' : 'PROC-VAULT-USD-002';
    const entryId = uuid();
    const now = new Date().toISOString();

    await db.query(
      `INSERT INTO vault_entries (id, group_id, account_id, direction, amount, currency, reference, source, status, metadata, created_at)
       VALUES (?, ?, ?, 'credit', ?, ?, ?, 'provider_transfer', 'POSTED', '{}', ?)`,
      [entryId, `PVDR-GRP-${entryId.slice(0,8)}`, accountId, amt, ccy, ref, now]
    );

    // Also update vault_accounts balance cache
    await db.query(
      `UPDATE vault_accounts SET balance = balance + ?, updated_at = ? WHERE id = ?`,
      [amt, now, accountId]
    );

    // Audit trail
    try {
      await db.query(
        `INSERT OR IGNORE INTO vault_audit_trail (id, account_id, type, amount, currency, reference, description, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [uuid(), accountId, 'PROVIDER_TRANSFER', amt, ccy, ref, `Provider transfer from ${merchantId}: ${ccy} ${amt}`, now]
      );
    } catch { /* non-critical */ }

    // Get new balance
    const balRows = await db.query(
      `SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END) - SUM(CASE WHEN direction='debit' THEN amount ELSE 0 END), 0) as bal FROM vault_entries WHERE account_id = ? AND currency = ? AND status = 'POSTED'`,
      [accountId, ccy]
    );
    const newBalance = Number((balRows.rows[0] as any)?.bal || 0);

    return res.json({
      ok: true,
      entryId,
      accountId,
      amount: amt,
      currency: ccy,
      reference: ref,
      vaultBalanceAfter: newBalance,
      providerConfirmation: providerResult.data,
      creditedAt: now,
      message: `${ccy} ${amt.toLocaleString(undefined, { minimumFractionDigits: 2 })} credited to vault bank from provider`,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /api/vault/bank-credentials ──────────────────────────────────────────
router.get('/bank-credentials', authenticateToken, (_req, res) => {
  const mask = (v?: string) => v ? (v.length > 8 ? v.slice(0, 4) + '•••••' + v.slice(-4) : '•••••') : '';
  return res.json({
    ok: true,
    vaultBank: {
      VAULT_BANK_PORT:         process.env.VAULT_BANK_PORT          || '',
      VAULT_BANK_BIND_HOST:    process.env.VAULT_BANK_BIND_HOST     || '',
      VAULT_BANK_API_KEY:      mask(process.env.VAULT_BANK_API_KEY),
      VAULT_BANK_SECRET_KEY:   mask(process.env.VAULT_BANK_SECRET_KEY),
      VAULT_BANK_TRANSFER_URL: process.env.VAULT_BANK_TRANSFER_URL  || '',
      VAULT_ACTIVE_API_KEY:    mask(process.env.VAULT_ACTIVE_API_KEY),
      KEY_ENDPOINT:            process.env.VAULT_BANK_TRANSFER_URL  || `http://127.0.0.1:${process.env.VAULT_BANK_PORT || '9001'}/api/vault/settlement`,
    },
    acquirer: {
      ACQUIRER_HOST:             process.env.ACQUIRER_HOST             || '',
      ACQUIRER_PORT:             process.env.ACQUIRER_PORT             || '9000',
      ACQUIRER_PROTOCOL:         process.env.ACQUIRER_PROTOCOL         || 'iso8583-tcp',
      ACQUIRER_API_KEY:          mask(process.env.ACQUIRER_API_KEY),
      ACQUIRER_TIMEOUT_MS:       process.env.ACQUIRER_TIMEOUT_MS       || '8000',
      ACQUIRER_MERCHANT_ACCOUNT: process.env.ACQUIRER_MERCHANT_ACCOUNT || 'MRC-1001',
      ACQUIRER_TLS_CERT:         process.env.ACQUIRER_TLS_CERT         || '',
      ACQUIRER_TLS_KEY:          mask(process.env.ACQUIRER_TLS_KEY),
      ACQUIRER_TLS_CA:           process.env.ACQUIRER_TLS_CA           || '',
      ACQUIRER_MAC_KEY:          mask(process.env.ACQUIRER_MAC_KEY),
      ACQUIRER_PIN_KEY:          mask(process.env.ACQUIRER_PIN_KEY),
    },
  });
});

// ── GET /api/vault/bank-credentials/reveal ────────────────────────────────────
router.get('/bank-credentials/reveal', authenticateToken, (_req, res) => {
  return res.json({
    ok: true,
    vaultBank: {
      VAULT_BANK_PORT:         process.env.VAULT_BANK_PORT          || '',
      VAULT_BANK_BIND_HOST:    process.env.VAULT_BANK_BIND_HOST     || '',
      VAULT_BANK_API_KEY:      process.env.VAULT_BANK_API_KEY       || '',
      VAULT_BANK_SECRET_KEY:   process.env.VAULT_BANK_SECRET_KEY    || '',
      VAULT_BANK_TRANSFER_URL: process.env.VAULT_BANK_TRANSFER_URL  || '',
      VAULT_ACTIVE_API_KEY:    process.env.VAULT_ACTIVE_API_KEY     || '',
      KEY_ENDPOINT:            process.env.VAULT_BANK_TRANSFER_URL  || `http://127.0.0.1:${process.env.VAULT_BANK_PORT || '9001'}/api/vault/settlement`,
    },
    acquirer: {
      ACQUIRER_HOST:             process.env.ACQUIRER_HOST             || '',
      ACQUIRER_PORT:             process.env.ACQUIRER_PORT             || '9000',
      ACQUIRER_PROTOCOL:         process.env.ACQUIRER_PROTOCOL         || 'iso8583-tcp',
      ACQUIRER_API_KEY:          process.env.ACQUIRER_API_KEY          || '',
      ACQUIRER_TIMEOUT_MS:       process.env.ACQUIRER_TIMEOUT_MS       || '8000',
      ACQUIRER_MERCHANT_ACCOUNT: process.env.ACQUIRER_MERCHANT_ACCOUNT || 'MRC-1001',
      ACQUIRER_TLS_CERT:         process.env.ACQUIRER_TLS_CERT         || '',
      ACQUIRER_TLS_KEY:          process.env.ACQUIRER_TLS_KEY          || '',
      ACQUIRER_TLS_CA:           process.env.ACQUIRER_TLS_CA           || '',
      ACQUIRER_MAC_KEY:          process.env.ACQUIRER_MAC_KEY          || '',
      ACQUIRER_PIN_KEY:          process.env.ACQUIRER_PIN_KEY          || '',
    },
  });
});

// ── POST /api/vault/bank-credentials/update ───────────────────────────────────
router.post('/bank-credentials/update', authenticateToken, async (req, res) => {
  try {
    const body = req.body || {};
    const allowed = [
      'VAULT_BANK_PORT','VAULT_BANK_BIND_HOST','VAULT_BANK_API_KEY',
      'VAULT_BANK_SECRET_KEY','VAULT_BANK_TRANSFER_URL','VAULT_ACTIVE_API_KEY',
      'ACQUIRER_HOST','ACQUIRER_PORT','ACQUIRER_PROTOCOL','ACQUIRER_API_KEY',
      'ACQUIRER_TIMEOUT_MS','ACQUIRER_MERCHANT_ACCOUNT','ACQUIRER_TLS_CERT',
      'ACQUIRER_TLS_KEY','ACQUIRER_TLS_CA','ACQUIRER_MAC_KEY','ACQUIRER_PIN_KEY',
    ];
    const updated: string[] = [];
    for (const key of allowed) {
      if (body[key] !== undefined && body[key] !== null) {
        process.env[key] = String(body[key]);
        updated.push(key);
      }
    }
    try {
      const { promises: fs } = await import('fs');
      const { join } = await import('path');
      const envPath = join(process.cwd(), '.env');
      let envContent = await fs.readFile(envPath, 'utf8');
      for (const key of updated) {
        const val = process.env[key] || '';
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, `${key}=${val}`);
        } else {
          envContent += `\n${key}=${val}`;
        }
      }
      await fs.writeFile(envPath, envContent, 'utf8');
    } catch (fsErr: any) {
      console.warn('[BankCredentials] Could not persist to .env:', fsErr.message);
    }
    return res.json({ ok: true, updated });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /api/vault/bank-credentials/rotate-api-key ──────────────────────────
router.post('/bank-credentials/rotate-api-key', authenticateToken, async (_req, res) => {
  try {
    const newApiKey    = generateVaultApiKey();
    const newSecretKey = generateVaultSecretKey();
    const now          = new Date().toISOString();
    process.env.VAULT_BANK_API_KEY    = newApiKey;
    process.env.VAULT_BANK_SECRET_KEY = newSecretKey;
    process.env.VAULT_ACTIVE_API_KEY  = newApiKey;
    await db.query('UPDATE vault_api_keys SET active = 0 WHERE active = 1');
    await db.query(
      `INSERT INTO vault_api_keys (id, api_key, secret_key, label, active, created_at) VALUES (?,?,?,?,1,?)`,
      [uuidv4(), newApiKey, newSecretKey, 'Vault Bank Key', now]
    );
    try {
      const { promises: fs } = await import('fs');
      const { join } = await import('path');
      const envPath = join(process.cwd(), '.env');
      let envContent = await fs.readFile(envPath, 'utf8');
      const setEnv = (k: string, v: string) => {
        const re = new RegExp(`^${k}=.*$`, 'm');
        return re.test(envContent) ? envContent.replace(re, `${k}=${v}`) : envContent + `\n${k}=${v}`;
      };
      envContent = setEnv('VAULT_BANK_API_KEY', newApiKey);
      envContent = setEnv('VAULT_BANK_SECRET_KEY', newSecretKey);
      envContent = setEnv('VAULT_ACTIVE_API_KEY', newApiKey);
      await fs.writeFile(envPath, envContent, 'utf8');
    } catch { /* non-critical */ }
    return res.json({ ok: true, newApiKey, newSecretKey, rotatedAt: now, warning: 'Store the secret key securely — shown once only.' });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// VAULT CARD ROUTES
// Settlement cards for PROC-VAULT-USD-002 / PROC-VAULT-EUR-001 / VAULT-WISE-EUR-001
// ════════════════════════════════════════════════════════════════════════════

// POST /api/vault/cards — issue a new vault card for a vault account
router.post('/cards', authenticateToken, vaultController.issueVaultCard.bind(vaultController));

// POST /api/vault/cards/bank — issue via legacy Vault Bank (fallback BIN)
router.post('/cards/bank', authenticateToken, vaultController.issueVaultBankCard.bind(vaultController));

// GET /api/vault/cards — list all vault cards (optionally filter by ?vault_account_id=)
router.get('/cards', authenticateToken, vaultController.listVaultCards.bind(vaultController));

// GET /api/vault/cards/:id — get a vault card by ID
router.get('/cards/:id', authenticateToken, vaultController.getVaultCard.bind(vaultController));

// GET /api/vault/cards/account/:vaultAccountId/active — get the active card for a vault account
router.get('/cards/account/:vaultAccountId/active', authenticateToken, vaultController.getActiveVaultCard.bind(vaultController));

// PATCH /api/vault/cards/:id/status — update card status (ACTIVE | SUSPENDED | TERMINATED)
router.patch('/cards/:id/status', authenticateToken, vaultController.updateVaultCardStatus.bind(vaultController));

// POST /api/vault/cards/:id/network-auth — generate real Visa/Mastercard network codes (ISO8583 0100 → TCP 9000)
router.post('/cards/:id/network-auth', authenticateToken, vaultController.networkAuthVaultCard.bind(vaultController));

// POST /api/vault/cards/network-auth — generate network codes by raw PAN/expiry/CVV (any vault BIN)
router.post('/cards/network-auth', authenticateToken, vaultController.networkAuthVaultCardByPan.bind(vaultController));

// ── POST /api/vault/wise-payout ───────────────────────────────────────────────
// Send real funds from vault directly to an external bank account via Wise.
// Debits vault balance, calls Wise API, returns Wise transfer ID.
// Body: { amount, currency, targetName, targetAccount, targetBic, reference? }
//   - USD: targetBic = ABA routing number, targetAccount = account number
//   - EUR: targetBic = SWIFT/BIC,           targetAccount = IBAN
//   - Other: targetBic = SWIFT/BIC,          targetAccount = account number
router.post('/wise-payout', authenticateToken, async (req, res) => {
  try {
    const { amount, currency, targetName, targetAccount, targetBic, targetCountry, targetCity, targetPostCode, targetAddressLine, reference, merchantId } = req.body || {};

    // Validate
    const amt = Number(amount);
    const ccy = String(currency || 'USD').toUpperCase().trim();
    if (!Number.isFinite(amt) || amt <= 0)   return res.status(400).json({ ok: false, error: 'amount must be a positive number' });
    if (!/^[A-Z]{3}$/.test(ccy))              return res.status(400).json({ ok: false, error: 'currency must be a 3-letter ISO code' });
    if (!targetName?.trim())                   return res.status(400).json({ ok: false, error: 'targetName (beneficiary name) is required' });
    if (!targetAccount?.trim())                return res.status(400).json({ ok: false, error: 'targetAccount (account number or IBAN) is required' });
    if (!targetBic?.trim())                    return res.status(400).json({ ok: false, error: 'targetBic (ABA routing for USD, SWIFT/BIC for others) is required' });

    // Check vault balance
    const vaultRow = (await db.query(
      `SELECT id, balance FROM vault_accounts WHERE currency = ? ORDER BY balance DESC LIMIT 1`,
      [ccy]
    )).rows[0] as any;
    const vaultBalance = Number(vaultRow?.balance ?? 0);
    if (vaultBalance < amt) {
      return res.status(409).json({
        ok: false,
        error: `Insufficient vault ${ccy} balance. Available: ${vaultBalance.toFixed(2)}, requested: ${amt.toFixed(2)}`,
        available: vaultBalance,
        requested: amt,
      });
    }

    // Debit vault before sending (atomic — roll back if Wise fails)
    const ref = String(reference || `WISE-${Date.now().toString(36).toUpperCase()}`).slice(0, 35);
    const now = new Date().toISOString();

    // Mark vault balance hold
    if (vaultRow?.id) {
      await db.query(
        `UPDATE vault_accounts SET balance = balance - ?, updated_at = ? WHERE id = ?`,
        [amt, now, vaultRow.id]
      );
    }

    // Write vault ledger debit entry
    const { v4: uuid } = await import('uuid');
    const ledgerId = uuid();
    await db.query(
      `INSERT INTO vault_ledger
        (id, ts, type, merchant_id, amount, currency, reference, status, meta)
       VALUES (?, ?, 'VAULT_TO_BANK', ?, ?, ?, ?, 'PENDING', ?)`,
      [ledgerId, now, merchantId || 'MRC-1001', -amt, ccy, ref,
       JSON.stringify({ destination: targetName, bic: targetBic, account: targetAccount.slice(-4).padStart(targetAccount.length, '*'), channel: 'wise' })]
    );

    // Call Wise
    const { wiseCollectAndSend } = await import('../payouts/wiseCollect.service');
    const wiseResult = await wiseCollectAndSend({
      amount:           amt,
      currency:         ccy,
      targetBic:        String(targetBic).trim(),
      targetAccount:    String(targetAccount).trim(),
      targetName:       String(targetName).trim(),
      targetAddressLines: targetAddressLine ? [String(targetAddressLine)] : undefined,
      targetCountry:    targetCountry ? String(targetCountry) : undefined,
      targetCity:       targetCity ? String(targetCity) : undefined,
      targetPostCode:   targetPostCode ? String(targetPostCode) : undefined,
      reference:        ref,
      merchantId:       merchantId || 'MRC-1001',
    });

    if (!wiseResult.success) {
      // Roll back vault debit
      if (vaultRow?.id) {
        await db.query(
          `UPDATE vault_accounts SET balance = balance + ?, updated_at = ? WHERE id = ?`,
          [amt, now, vaultRow.id]
        );
      }
      await db.query(
        `UPDATE vault_ledger SET status = 'FAILED', meta = ? WHERE id = ?`,
        [JSON.stringify({ error: wiseResult.message }), ledgerId]
      );
      return res.status(502).json({ ok: false, error: wiseResult.message, wiseBalance: wiseResult.wiseBalance });
    }

    // Wise confirmed — mark ledger entry as COMPLETED
    await db.query(
      `UPDATE vault_ledger SET status = 'COMPLETED', meta = ? WHERE id = ?`,
      [JSON.stringify({
        destination:      targetName,
        bic:              targetBic,
        account:          targetAccount.slice(-4).padStart(targetAccount.length, '*'),
        channel:          'wise',
        wise_transfer_id: wiseResult.transferId,
        wise_uetr:        wiseResult.uetr,
        wise_status:      wiseResult.status,
      }), ledgerId]
    );

    // Persist to wise_payouts table
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS wise_payouts (
          id TEXT PRIMARY KEY, transfer_id TEXT, profile_id TEXT,
          amount REAL, currency TEXT, target_bic TEXT, target_account TEXT,
          target_name TEXT, reference TEXT, merchant_id TEXT,
          wise_balance_before REAL, status TEXT, created_at TEXT
        )
      `);
      await db.query(
        `INSERT OR IGNORE INTO wise_payouts
          (id, transfer_id, profile_id, amount, currency, target_bic, target_account,
           target_name, reference, merchant_id, wise_balance_before, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [uuid(), wiseResult.transferId || ledgerId, wiseResult.profileId || '',
         amt, ccy, targetBic, targetAccount, targetName, ref,
         merchantId || 'MRC-1001', wiseResult.wiseBalance || 0,
         wiseResult.status || 'SUBMITTED', now]
      );
    } catch { /* non-critical */ }

    const newBalance = Number((await db.query(
      `SELECT balance FROM vault_accounts WHERE id = ?`, [vaultRow.id]
    )).rows[0]?.balance || 0);

    console.log(`[VaultWisePayout] ✅ ${ccy} ${amt} → ${targetName} | Wise transfer: ${wiseResult.transferId} | UETR: ${wiseResult.uetr}`);

    return res.status(201).json({
      ok:              true,
      transferId:      wiseResult.transferId,
      uetr:            wiseResult.uetr,
      status:          wiseResult.status,
      amount:          amt,
      currency:        ccy,
      beneficiary:     targetName,
      reference:       ref,
      vaultBalanceAfter: newBalance,
      message:         wiseResult.message,
    });
  } catch (e: any) {
    console.error('[VaultWisePayout] Error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ABSA BUSINESS BANK — Vault → ABSA settlement endpoints
// Position: final destination for large vault balances (gold supplier payments)
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/vault/send-to-absa
 * Send funds from vault to ABSA Business account (no withdrawal limits).
 * Used by merchant to settle large amounts to gold suppliers / other banks.
 *
 * Body: {
 *   amount, currency,
 *   beneficiaryName, beneficiaryAccount, beneficiaryBank,
 *   beneficiarySwift, beneficiaryAddress?, beneficiaryCountry?,
 *   reference, transferType: 'SWIFT'|'RTGS'|'SEPA'|'ACH', note?
 * }
 */
router.post('/send-to-absa', authenticateToken, async (req, res) => {
  try {
    const {
      amount, currency, beneficiaryName, beneficiaryAccount,
      beneficiaryBank, beneficiarySwift, beneficiaryAddress,
      beneficiaryCountry, reference, transferType, note,
    } = req.body || {};

    if (!amount || !currency || !beneficiaryName || !beneficiaryAccount || !beneficiarySwift || !reference) {
      return res.status(400).json({
        ok: false,
        error: 'amount, currency, beneficiaryName, beneficiaryAccount, beneficiarySwift and reference are required',
      });
    }

    const amt = Number(amount);
    const ccy = String(currency).toUpperCase();

    // Debit vault account first
    const vaultRow = (await db.query(
      'SELECT id, balance FROM vault_accounts WHERE currency = ? LIMIT 1', [ccy]
    )).rows[0] as any;

    if (!vaultRow) {
      return res.status(400).json({ ok: false, error: `No vault account found for ${ccy}` });
    }
    if (Number(vaultRow.balance) < amt) {
      return res.status(409).json({
        ok: false,
        error: `Insufficient vault balance: available=${Number(vaultRow.balance).toFixed(2)} ${ccy}, requested=${amt.toFixed(2)}`,
      });
    }

    const now = new Date().toISOString();
    await db.query(
      'UPDATE vault_accounts SET balance = balance - ?, updated_at = ? WHERE id = ?',
      [amt, now, vaultRow.id]
    );

    // Send to ABSA
    const result = await sendToAbsa({
      amount: amt,
      currency: ccy,
      beneficiaryName:    String(beneficiaryName),
      beneficiaryAccount: String(beneficiaryAccount),
      beneficiaryBank:    String(beneficiaryBank || ''),
      beneficiarySwift:   String(beneficiarySwift),
      beneficiaryAddress: beneficiaryAddress ? String(beneficiaryAddress) : undefined,
      beneficiaryCountry: beneficiaryCountry ? String(beneficiaryCountry) : undefined,
      reference:          String(reference),
      transferType:       (String(transferType || 'SWIFT').toUpperCase() as any),
      note:               note ? String(note) : undefined,
    });

    if (!result.ok) {
      // Rollback vault debit
      await db.query(
        'UPDATE vault_accounts SET balance = balance + ?, updated_at = ? WHERE id = ?',
        [amt, now, vaultRow.id]
      );
      return res.status(502).json(result);
    }

    // Ledger entry
    await db.query(`
      INSERT OR IGNORE INTO vault_ledger
        (id, ts, type, merchant_id, amount, currency, reference, status, meta)
      VALUES (?, ?, 'VAULT_TO_ABSA', NULL, ?, ?, ?, 'COMPLETED', ?)
    `, [
      uuidv4(), now, -amt, ccy, String(reference),
      JSON.stringify({ absaTransferId: result.transferId, beneficiary: String(beneficiaryName) }),
    ]).catch(() => {});

    return res.json({ ...result, ok: true, vaultBalanceAfter: Number(vaultRow.balance) - amt });
  } catch (err: any) {
    console.error('[ABSA /send-to-absa]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/vault/absa/balance?currency=USD
 * Check ABSA account balance.
 */
router.get('/absa/balance', authenticateToken, async (req, res) => {
  try {
    const currency = String(req.query.currency || 'USD');
    const balance  = await getAbsaBalance(currency);
    return res.json({ ok: true, ...balance });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/vault/absa/transfer/:id
 * Check ABSA transfer status.
 */
router.get('/absa/transfer/:id', authenticateToken, async (req, res) => {
  try {
    const result = await getAbsaTransferStatus(req.params.id);
    return res.json({ ok: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/vault/absa/transactions
 * List recent ABSA account transactions.
 */
router.get('/absa/transactions', authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const txns  = await getAbsaTransactions(limit);
    return res.json({ ok: true, count: txns.length, transactions: txns });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/vault/absa/webhook
 * ABSA incoming payment webhook — auto-credits vault Omnibus.
 * ABSA sends X-ABSA-Signature header for verification.
 */
router.post('/absa/webhook', async (req, res) => {
  try {
    const signature = String(req.headers['x-absa-signature'] || '');
    const rawBody   = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));

    if (!verifyAbsaWebhook(rawBody, signature)) {
      return res.status(401).json({ ok: false, error: 'Invalid ABSA webhook signature' });
    }

    await handleAbsaIncomingCredit(req.body);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[ABSA /absa/webhook]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;