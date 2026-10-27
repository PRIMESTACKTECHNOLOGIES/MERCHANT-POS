import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import { authenticateToken } from '../../middleware/auth.middleware';
import { requirePermission, requireMFA, enforceIPWhitelist } from '../../middleware/security.middleware';
import { vaultBankService } from './vaultBank.service';
import { generateVaultApiKey, generateVaultSecretKey } from './gateway/auth/apiKey';
import { vaultController } from './vault.controller';
import { transferMerchantFundsToVault } from './merchantVaultTransfer.service';
import crypto from 'crypto';
import { custodyReserveEngine } from './custodyReserve.service';
import { creditCard, debitCard, getCardBalance } from './cardBalance.service';
import { luhnValidate } from './luhn';
import { verifyVaultApiKey } from './gateway/middleware/verifyApiKey';
import { verifyVaultHmac } from './gateway/middleware/verifySignature';
import { vaultRateLimiter } from './gateway/middleware/rateLimiter';

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
// Vault ledger writes require the same HMAC gateway auth as /api/vault-bank/*.
// These two routes previously accepted unauthenticated credits/debits, so anyone
// who could reach the host could mint ledger balance from thin air.
router.post('/credit', verifyVaultApiKey, verifyVaultHmac, vaultRateLimiter, vaultController.creditVault.bind(vaultController));
router.post('/debit', verifyVaultApiKey, verifyVaultHmac, vaultRateLimiter, vaultController.debitVault.bind(vaultController));
router.post('/merchant-transfer', async (req, res) => {
  try {
    const result = await transferMerchantFundsToVault({
      merchantId: req.body?.merchantId || req.body?.merchant_id,
      amount: req.body?.amount,
      currency: req.body?.currency,
      reference: req.body?.reference,
    });

    // ── Auto-credit Wise balance (disabled — use manual payout instead) ──
    return res.status(201).json(result);
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
    return res.json(await custodyReserveEngine.getSummary(req.params.currency));
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
router.post('/custody-reserve/withdrawals', authenticateToken, enforceIPWhitelist(), requirePermission('vault.withdraw'), requireMFA(), async (req, res) => {
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
router.post('/custody-reserve/withdrawals/:id/settle', authenticateToken, enforceIPWhitelist(), requirePermission('vault.withdraw'), requireMFA(), async (req, res) => {
  try {
    return res.json(await custodyReserveEngine.settleWithdrawal(req.params.id, String(req.body?.providerReference || '')));
  } catch (error: any) {
    const status = error?.code === 'NOT_FOUND' ? 404 : error?.code === 'VALIDATION_ERROR' ? 400 : error?.code === 'INVALID_STATE' ? 409 : 500;
    return res.status(status).json({ error: error?.code || 'INTERNAL_ERROR', message: error?.message || 'Failed to settle custody withdrawal' });
  }
});
router.post('/custody-reserve/withdrawals/:id/release', authenticateToken, enforceIPWhitelist(), requirePermission('vault.withdraw'), requireMFA(), async (req, res) => {
  try {
    return res.json(await custodyReserveEngine.releaseWithdrawal(req.params.id));
  } catch (error: any) {
    const status = error?.code === 'NOT_FOUND' ? 404 : error?.code === 'INVALID_STATE' ? 409 : 500;
    return res.status(status).json({ error: error?.code || 'INTERNAL_ERROR', message: error?.message || 'Failed to release custody withdrawal' });
  }
});
router.post('/custody-reserve/crypto-purchases', authenticateToken, enforceIPWhitelist(), requirePermission('vault.withdraw'), requireMFA(), async (req, res) => {
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
      cardholderName: process.env.VAULT_CARDHOLDER_NAME?.trim() || process.env.OPERATOR_CARD_USD_HOLDER?.trim() || 'AJI ALOSIOUS',
      cardNumber: process.env.VAULT_CARD_PAN?.trim() || process.env.OPERATOR_CARD_USD_NUMBER?.trim(),
      expiry: process.env.VAULT_CARD_EXPIRY?.trim() || process.env.OPERATOR_CARD_USD_EXPIRY?.trim() || '05/30',
      cvv: process.env.VAULT_CARD_CVV?.trim() || process.env.OPERATOR_CARD_USD_CVV?.trim(),
      currency: 'USD',
      card_type: (process.env.VAULT_CARD_TYPE?.trim() || 'credit').toLowerCase(),
      credit_limit: Number(process.env.VAULT_CARD_CREDIT_LIMIT || '5000000'),
      status: 'ACTIVE',
    },
    {
      id: 'eur',
      cardholderName: process.env.VAULT_EUR_CARDHOLDER_NAME?.trim() || process.env.OPERATOR_CARD_EUR_HOLDER?.trim() || 'DANIA ALOSIOUS',
      cardNumber: process.env.VAULT_EUR_CARD_PAN?.trim() || process.env.OPERATOR_CARD_EUR_NUMBER?.trim(),
      expiry: process.env.VAULT_EUR_CARD_EXPIRY?.trim() || process.env.OPERATOR_CARD_EUR_EXPIRY?.trim() || '06/29',
      cvv: process.env.VAULT_EUR_CARD_CVV?.trim() || process.env.OPERATOR_CARD_EUR_CVV?.trim(),
      currency: 'EUR',
      card_type: (process.env.VAULT_EUR_CARD_TYPE?.trim() || 'credit').toLowerCase(),
      credit_limit: Number(process.env.VAULT_EUR_CARD_CREDIT_LIMIT || '5000000'),
      status: 'ACTIVE',
    },
  ];
  // Cards are always active — fall back to masked display if PAN/CVV not set
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

// Issue an ADDITIONAL vault API key without deactivating the existing ones.
// Used to hand credentials to an external funder server that pushes
// server-to-card loads to /api/vault/card-load/webhook.
router.post('/security/api-key/mint', authenticateToken, async (req, res) => {
  try {
    const label = String(req.body?.label || '').trim();
    if (!label) return res.status(400).json({ error: 'label is required' });
    const apiKey = generateVaultApiKey();
    const secretKey = generateVaultSecretKey();
    const createdAt = new Date().toISOString();
    const id = uuidv4();
    await db.query(
      `INSERT INTO vault_api_keys (id, api_key, secret_key, label, active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [id, apiKey, secretKey, label, createdAt],
    );
    return res.status(201).json({
      id, apiKey, secretKey, label, createdAt,
      warning: 'Store the secret key securely. It is shown once and cannot be retrieved later.',
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: error?.message || 'Failed to mint API key' });
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

// ── vault_card_loads (shared by outbound and inbound card loads) ─────────────
async function ensureVaultCardLoadsTable(): Promise<void> {
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
}

// Idempotency guard for inbound server-to-card loads: the same funder server
// may only ever apply a given source reference once. Scoped to inbound rows
// (vault_account_id = 'INBOUND_SERVER') so outbound provider loads keep their
// own reference namespace, and per funder so two servers can reuse a reference.
async function ensureInboundSourceRefIndex(): Promise<void> {
  await db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_vcl_inbound_source_ref
       ON vault_card_loads(provider_name, source_reference)
       WHERE vault_account_id = 'INBOUND_SERVER'`,
  );
}

const CARD_LOAD_FUNDING_METHODS = ['card-to-card', 'server-to-card', 'bank-to-card', 'wallet-to-card'];
const CARD_LOAD_TRANSFER_TYPES = ['SWIFT', 'SEPA', 'DOMESTIC', 'ACH', 'RTGS', 'IMPS', 'PIX', 'FASTER_PAYMENTS', 'FEDWIRE'];

/** Returns an error string when the source details are incomplete for the given funding route. */
function cardLoadRouteError(fundingMethod: string, sourceDetails: any): string | null {
  const missing = fundingMethod === 'card-to-card'
    ? !sourceDetails?.sourceCardReference
    : fundingMethod === 'server-to-card'
      ? !sourceDetails?.sourceServerReference || !sourceDetails?.sourceServerName || !sourceDetails?.sourceServerAccount
      : fundingMethod === 'bank-to-card'
        ? !sourceDetails?.sourceBankReference || !sourceDetails?.sourceBankName || !sourceDetails?.sourceBankSenderName
        : !sourceDetails?.sourceWalletId || !sourceDetails?.sourceWalletNetwork || !sourceDetails?.sourceWalletTransactionId;
  return missing ? `All required source details are required for ${fundingMethod}` : null;
}

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
    const methods = CARD_LOAD_FUNDING_METHODS;
    const normalizedCardId = String(cardId).toLowerCase();
    const cardCurrency = normalizedCardId === 'usd' ? 'USD' : normalizedCardId === 'eur' ? 'EUR' : '';
    if (!methods.includes(String(fundingMethod)) || !endpoint || !apiKey || !providerName || !providerAccount || !sourceReference || !cardCurrency || !ccy || ccy !== cardCurrency || !Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'providerName, providerAccount, endpoint, apiKey, sourceReference, cardId, currency, and positive amount are required' });
    }
    const routeError = cardLoadRouteError(String(fundingMethod), sourceDetails);
    if (routeError) {
      return res.status(400).json({ error: routeError });
    }
    const transferTypes = CARD_LOAD_TRANSFER_TYPES;
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
    await ensureVaultCardLoadsTable();
    await db.query(
      `INSERT INTO vault_card_loads
        (id, vault_account_id, currency, amount, card_label, note, status, loaded_at,
         funding_method, provider_name, provider_account, source_reference, provider_reference,
         request_reference, transfer_type, transfer_network_code)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        loadId, 'EXTERNAL_PROVIDER', ccy, amt, String(cardId),
        note ? String(note) : `External reference: ${sourceReference}`, now,
        String(fundingMethod), String(providerName), String(providerAccount),
        String(sourceReference), providerReference, requestReference,
        fundingMethod === 'bank-to-card' ? String(sourceDetails?.transferType || '').toUpperCase() : null,
        fundingMethod === 'bank-to-card' ? (sourceDetails?.transferNetworkCode ? String(sourceDetails.transferNetworkCode).toUpperCase() : null) : null,
      ],
    );

    // The custody reserve alone leaves the card unspendable. The provider has
    // confirmed the funds, so credit the card's real spendable balance too —
    // otherwise the load reports CONFIRMED while the card still spends $0.
    // This runs AFTER the vault_card_loads insert so a duplicate sourceReference
    // fails the unique constraint first and can never double-credit the card.
    let txn;
    try {
      txn = await creditCard(
        normalizedCardId, ccy, amt, String(fundingMethod).replace(/-/g, '_'),
        String(providerReference || sourceReference), String(sourceReference),
        note ? String(note) : `${fundingMethod} load via ${providerName}`,
      );
    } catch (creditErr: any) {
      await db.query(`UPDATE vault_card_loads SET status = 'FAILED' WHERE id = ?`, [loadId]).catch(() => {});
      throw creditErr;
    }
    await db.query(
      `UPDATE vault_card_loads SET status = 'LOADED', request_reference = ? WHERE id = ?`,
      [txn.id, loadId],
    );

    const cardBal = await getCardBalance(normalizedCardId, ccy);
    return res.json({
      ok: true, status: 'CONFIRMED', loadId, cardTxnId: txn.id,
      cardId: normalizedCardId, currency: ccy, amount: amt,
      cardBalance: cardBal.balance, providerReference, reserve, provider: responseBody,
    });
  } catch (e: any) {
    return res.status(502).json({ error: e?.message || 'External card load failed' });
  }
});
// ── POST /api/vault/card-load/webhook ────────────────────────────────────────
// Inbound server-to-card load. A funder server that holds a real available
// balance debits that balance and pushes the confirmation here; we credit the
// target vault card's spendable balance (vault_card_balances) — the same
// balance the card spends from.
//
// Auth (identical to /api/vault/credit and /api/vault/debit):
//   x-api-key, x-timestamp (unix ms), x-nonce,
//   x-signature = HMAC_SHA512(secretKey, `${timestamp}.${nonce}.${JSON.stringify(body)}`)
//
// Body: {
//   sourceServer:    'FRIEND-SRV-01',    // funder server identity
//   sourceReference: 'SRV-TXN-8891',     // unique transaction id on their side
//   cardId:          'usd' | 'eur',
//   currency:        'USD' | 'EUR',
//   amount:          2500.00,
//   senderName?, note?
// }
//
// Replays of the same sourceReference never credit twice.
router.post('/card-load/webhook', verifyVaultApiKey, verifyVaultHmac, vaultRateLimiter, async (req, res) => {
  try {
    const { sourceServer, sourceReference, cardId, currency, amount, senderName, note } = req.body || {};
    const ccy = String(currency || '').toUpperCase().trim();
    const amt = Number(amount);
    const normalizedCardId = String(cardId || '').toLowerCase();
    const cardCurrency = normalizedCardId === 'usd' ? 'USD' : normalizedCardId === 'eur' ? 'EUR' : '';
    if (!sourceServer || !sourceReference || !cardCurrency || !ccy || ccy !== cardCurrency
        || !Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({
        error: 'sourceServer, sourceReference, cardId (usd|eur), matching currency, and a positive amount are required',
      });
    }

    const server = String(sourceServer).trim();
    const ref = String(sourceReference).trim();
    await ensureVaultCardLoadsTable();
    await ensureInboundSourceRefIndex();

    const loadId = uuidv4();
    try {
      await db.query(
        `INSERT INTO vault_card_loads
          (id, vault_account_id, currency, amount, card_label, note, status, loaded_at,
           funding_method, provider_name, provider_account, source_reference, provider_reference)
         VALUES (?, 'INBOUND_SERVER', ?, ?, ?, ?, 'PENDING', ?, 'server-to-card', ?, ?, ?, ?)`,
        [
          loadId, ccy, amt, normalizedCardId,
          note ? String(note) : null, new Date().toISOString(),
          server, senderName ? String(senderName) : null, ref,
          `INBOUND:${server}:${ref}`,
        ],
      );
    } catch (insertErr: any) {
      if (!/unique|constraint/i.test(String(insertErr?.message))) throw insertErr;
      const existing = (await db.query(
        `SELECT id, status, amount, currency, card_label, request_reference
           FROM vault_card_loads
          WHERE vault_account_id = 'INBOUND_SERVER' AND provider_name = ? AND source_reference = ?
          LIMIT 1`,
        [server, ref],
      )).rows[0] as any;
      if (existing?.status === 'LOADED') {
        return res.json({
          ok: true, idempotent: true, status: 'CREDITED', loadId: existing.id,
          cardId: existing.card_label, currency: existing.currency,
          amount: Number(existing.amount), cardTxnId: existing.request_reference,
        });
      }
      return res.status(409).json({ error: 'This source reference is already being processed by another request' });
    }

    let txn;
    try {
      txn = await creditCard(
        normalizedCardId, ccy, amt, 'server_to_card', ref, `INBOUND:${server}:${ref}`,
        note ? String(note) : `Inbound server load from ${server}`,
      );
    } catch (creditErr: any) {
      await db.query(`UPDATE vault_card_loads SET status = 'FAILED' WHERE id = ?`, [loadId]).catch(() => {});
      throw creditErr;
    }
    await db.query(
      `UPDATE vault_card_loads SET status = 'LOADED', request_reference = ? WHERE id = ?`,
      [txn.id, loadId],
    );

    const bal = await getCardBalance(normalizedCardId, ccy);
    console.log(`[Vault] ✅ Inbound server-to-card ${ccy} ${amt.toFixed(2)} from ${server} (${ref}) → card ${normalizedCardId} | balance ${bal.balance.toFixed(2)}`);
    return res.json({
      ok: true, status: 'CREDITED', loadId, cardTxnId: txn.id,
      cardId: normalizedCardId, currency: ccy, amount: amt, cardBalance: bal.balance,
    });
  } catch (e: any) {
    console.error('[Vault] inbound card-load webhook failed:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Inbound card load failed' });
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
      `SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END) - SUM(CASE WHEN direction='debit' THEN amount ELSE 0 END), 0) as bal FROM vault_entries WHERE account_id = ? AND currency = ?`,
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
// Settlement cards for PROC-VAULT-USD-002 / PROC-VAULT-EUR-001
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

<<<<<<< Updated upstream
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
=======
export default router;

// ── POST /api/vault/buy-crypto ────────────────────────────────────────────────
// Buy crypto directly using vault balance.
// Body: { asset, amount, currency?, merchantId? }
// Debits vault ledger and credits the merchant's crypto wallet.
router.post('/buy-crypto', authenticateToken, async (req, res) => {
  try {
    const asset      = String(req.body?.asset || req.body?.cryptoCoin || '').toUpperCase().trim();
    const amount     = Number(req.body?.amount || req.body?.fiatAmount || 0);
    const currency   = String(req.body?.currency || 'USD').toUpperCase();
    const merchantId = String(req.body?.merchantId || 'MRC-1001').trim();
    const network    = req.body?.network ? String(req.body.network) : undefined;

    if (!asset || !amount || amount <= 0) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'asset and positive amount are required' });
    }

    // 1. Check vault balance
    const { vaultEngine } = await import('./vault.service');
    const vaultBalance = await vaultEngine.getVaultBalance(currency);
    if (vaultBalance < amount) {
      return res.status(409).json({
        error: 'INSUFFICIENT_VAULT_FUNDS',
        message: `Vault ${currency} balance is ${vaultBalance.toFixed(2)}, need ${amount.toFixed(2)}`,
      });
    }

    // 2. Execute crypto purchase via exchange router
    const xr = await import('../../exchange/exchange-router.service');
    const order = await xr.buyAssetBestEffort(asset, amount);
    if (!order?.ok || Number(order.executedQty || 0) <= 0) {
      return res.status(502).json({
        error: 'EXCHANGE_FAILED',
        message: order?.raw?.note || order?.status || 'Exchange did not confirm purchase',
        provider: order?.provider,
      });
    }

    const cryptoAmount = Number(order.executedQty);

    // 3. Debit vault
    const ref = `VAULT-CRYPTO-${asset}-${Date.now().toString(36).toUpperCase()}`;
    await vaultEngine.debitVault({
      amount,
      currency,
      reference: ref,
      merchantId,
      type: 'VAULT_TO_MERCHANT',
      meta: { asset, cryptoAmount, provider: order.provider, orderId: order.order_id },
    });

    // 4. Credit merchant crypto wallet
    const { walletsService } = await import('../wallets/wallets.service');
    const cryptoWallet = await walletsService.getOrCreateCryptoWallet(merchantId, asset);
    await db.query(
      'UPDATE customer_crypto_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [cryptoAmount, cryptoWallet.id]
    );

    // 5. Record transaction
    const { v4: uuidv4 } = await import('uuid');
    await db.query(
      `INSERT OR IGNORE INTO crypto_transactions
         (id, customer_id, crypto_coin, transaction_type, fiat_amount, crypto_amount,
          fiat_currency, exchange_rate, source, provider_mode, status, reference)
       VALUES (?, ?, ?, 'buy', ?, ?, ?, ?, 'vault_bank', ?, 'completed', ?)`,
      [
        uuidv4(), merchantId, asset, amount, cryptoAmount, currency,
        amount > 0 && cryptoAmount > 0 ? amount / cryptoAmount : 0,
        order.provider || 'exchange', ref,
      ]
    );

    console.log(`[Vault→Crypto] ✅ Bought ${cryptoAmount} ${asset} for ${currency} ${amount} — provider=${order.provider}`);

    return res.status(201).json({
      ok: true,
      asset,
      cryptoAmount,
      fiatAmount: amount,
      currency,
      exchangeRate: amount / cryptoAmount,
      provider: order.provider,
      orderId: order.order_id || ref,
      vaultBalanceAfter: await vaultEngine.getVaultBalance(currency),
>>>>>>> Stashed changes
    });

  } catch (error: any) {
    const status = error?.code === 'NO_FUNDS' ? 409 : error?.code === 'VALIDATION_ERROR' ? 400 : 502;
    return res.status(status).json({ error: error?.code || 'VAULT_CRYPTO_BUY_FAILED', message: error?.message || 'Vault crypto buy failed' });
  }
});
<<<<<<< Updated upstream

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

// ════════════════════════════════════════════════════════════════════════════
// ACQUIRER-FACING CARD ENDPOINTS (HTTP-JSON mode)
// Used by HttpAcquirerClient when ACQUIRER_PROTOCOL=http-json.
// These endpoints perform REAL card validation + balance debit before approval.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Map a card PAN to its internal cardId (usd | eur | etc).
 * Matches against operator card PANs configured in environment variables.
 */
function panToCardId(pan: string): string | null {
  const cleanPan = String(pan || '').replace(/\D/g, '');
  const usdPan = String(process.env.OPERATOR_CARD_USD_NUMBER || process.env.VAULT_CARD_PAN || '').replace(/\D/g, '');
  const eurPan = String(process.env.OPERATOR_CARD_EUR_NUMBER || process.env.VAULT_EUR_CARD_PAN || '').replace(/\D/g, '');
  if (usdPan && cleanPan === usdPan) return 'usd';
  if (eurPan && cleanPan === eurPan) return 'eur';
  // Fallback: detect by currency via BIN prefix if operator cards not configured
  return null;
}

/**
 * POST /api/vault/card/authorize
 * Acquirer-facing authorization endpoint.
 * Validates the card (Luhn, expiry, CVV), checks real balance, and debits the card.
 * Body: { cardNumber, expiry, cvv, amountMinor, currency, merchantAccount, protocol }
 */
router.post('/card/authorize', async (req, res) => {
  try {
    const { cardNumber, expiry, cvv, amountMinor, currency } = req.body || {};
    const cleanPan = String(cardNumber || '').replace(/\D/g, '');
    const amountMajor = Number(amountMinor) / 100;
    const ccy = String(currency || 'USD').toUpperCase();

    // ── 1. Validate card fields ────────────────────────────────────────────
    if (!cleanPan || cleanPan.length < 13 || cleanPan.length > 19) {
      return res.json({ success: false, responseCode: '14', status: 'Declined', message: 'Invalid card number' });
    }
    if (!luhnValidate(cleanPan)) {
      return res.json({ success: false, responseCode: '14', status: 'Declined', message: 'Card number failed Luhn check' });
    }
    if (!expiry || !/^\d{2}\/\d{2}$/.test(String(expiry))) {
      return res.json({ success: false, responseCode: '54', status: 'Declined', message: 'Invalid expiry date' });
    }
    // Check expiry is not in the past
    const [expMonth, expYear] = String(expiry).split('/');
    const now = new Date();
    const cardExpiry = new Date(2000 + Number(expYear), Number(expMonth), 0, 23, 59, 59);
    if (cardExpiry < now) {
      return res.json({ success: false, responseCode: '54', status: 'Declined', message: 'Card expired' });
    }
    if (!cvv || !/^\d{3,4}$/.test(String(cvv))) {
      return res.json({ success: false, responseCode: '56', status: 'Declined', message: 'Invalid CVV' });
    }
    if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
      return res.json({ success: false, responseCode: '13', status: 'Declined', message: 'Invalid amount' });
    }

    // ── 2. Map PAN to internal cardId (vault-issued operator card) ─────────
    const cardId = panToCardId(cleanPan);

    if (cardId) {
      // ── INTERNAL VAULT CARD (internal ledger, no real funds yet) ────────
      // Debits the vault card balance. Funds go to CUSTOMER wallet (internal ledger).
      // Customer must later provide provider API credentials to pull real funds
      // into the MERCHANT wallet.
      const balance = await getCardBalance(cardId, ccy);
      if (balance.balance < amountMajor) {
        return res.json({
          success: false, responseCode: '51', status: 'Declined',
          message: `Insufficient card balance. Available: ${ccy} ${balance.balance.toFixed(2)}, requested: ${ccy} ${amountMajor.toFixed(2)}`,
        });
      }

      const authRef = `AUTH-${Date.now().toString(36).toUpperCase()}`;
      const approvalCode = String(Math.floor(100000 + Math.random() * 900000));
      const txn = await debitCard(cardId, ccy, amountMajor, authRef, `POS charge ${cleanPan.slice(-4)}`);

      console.log(`[VaultAcquirer] ✅ INTERNAL card authorized | card=${cardId} | amount=${ccy} ${amountMajor.toFixed(2)} | balance_after=${txn.balanceAfter.toFixed(2)} | auth=${authRef}`);

      return res.json({
        success: true,
        responseCode: '00',
        status: 'Approved',
        authRef,
        approvalCode,
        fundsType: 'internal',
        cardType: 'vault',
        message: `Approved — ${ccy} ${amountMajor.toFixed(2)} debited from vault card (internal ledger)`,
      });
    }

    // ── 3. EXTERNAL CARD (VISA/MC) — NOT authorizable at this endpoint ───────
    // A VISA/MC PAN can only be authorized by its issuer over the card scheme.
    // This endpoint serves vault-issued cards (internal ledger) only. Approving
    // an external PAN here would fabricate an approval with no real card debit
    // (money from thin air), so it is declined instead.
    console.warn(`[VaultAcquirer] ⛔ EXTERNAL card rejected — no scheme authorization | pan=****${cleanPan.slice(-4)} | ${ccy} ${amountMajor.toFixed(2)}`);
    return res.json({
      success: false,
      responseCode: '96',
      status: 'Declined',
      fundsType: 'external',
      cardType: 'external',
      message: 'External card requires a live card-scheme authorization — this vault endpoint cannot approve it (no self-approval).',
    });
  } catch (err: any) {
    const code = err?.code === 'INSUFFICIENT_CARD_BALANCE' ? '51'
      : err?.code === 'NO_CARD_BALANCE' ? '51'
      : '96';
    console.error('[VaultAcquirer /card/authorize]', err?.message || err);
    return res.json({ success: false, responseCode: code, status: 'Declined', message: err?.message || 'Authorization failed' });
  }
});

/**
 * POST /api/vault/card/capture
 * Acquirer-facing capture endpoint.
 * Since /card/authorize already debited the card, this confirms the capture.
 * Body: { authRef, amountMinor, currency, merchantAccount }
 */
router.post('/card/capture', async (req, res) => {
  try {
    const { authRef, authorizationReference, amountMinor, currency } = req.body || {};
    const ccy = String(currency || 'USD').toUpperCase();
    const captureRef = `CAP-${Date.now().toString(36).toUpperCase()}`;
    const ref = String(authRef || authorizationReference || '');

    if (!ref) {
      return res.json({ success: false, responseCode: '25', status: 'Declined', message: 'No authorization reference provided' });
    }

    console.log(`[VaultAcquirer] ✅ Capture confirmed | authRef=${ref} | amount=${ccy} ${(Number(amountMinor) / 100).toFixed(2)}`);

    return res.json({
      success: true,
      responseCode: '00',
      status: 'Captured',
      captureRef,
      message: 'Capture confirmed — card was debited at authorization',
    });
  } catch (err: any) {
    console.error('[VaultAcquirer /card/capture]', err?.message || err);
    return res.json({ success: false, responseCode: '96', status: 'Declined', message: err?.message || 'Capture failed' });
  }
});

/**
 * GET /api/vault/card/balance/:cardId?currency=USD
 * Acquirer-facing balance inquiry endpoint.
 */
router.get('/card/balance/:cardId', async (req, res) => {
  try {
    const { cardId } = req.params;
    const currency = String(req.query.currency || 'USD').toUpperCase();
    const balance = await getCardBalance(cardId, currency);
    return res.json({ ok: true, ...balance });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to load card balance' });
  }
});

export default router;
=======
>>>>>>> Stashed changes
