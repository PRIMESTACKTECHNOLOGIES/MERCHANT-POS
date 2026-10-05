import { Router } from 'express';
import { walletsService } from '../wallets/wallets.service';
import { walletsController } from '../wallets/wallets.controller';
import { fundsSettlementService } from '../settlements/funds-settlement.service';
import { db } from '../../config/db';
import { syncOfflinePreflight } from '../payments/offline-decline-preflight';

const router = Router();

// POST /api/customers
router.post('/customers', async (req, res) => {
  try {
    const { name, email, phone } = req.body || {};
    const trimmedName = (name || '').trim();
    if (!trimmedName) return res.status(400).json({ error: 'Name is required' });
    const customer = await walletsService.createCustomer(trimmedName, email, phone);
    const wallet = await walletsService.getOrCreateWallet(customer.id);
    res.json({
      customer_id: customer.id,
      customer_name: customer.name,
      wallet: { id: wallet.id, balance: Number(wallet.balance), currency: wallet.currency, wallet_code: wallet.wallet_code }
    });
  } catch (e: any) { res.status(e.message.includes('required') || e.message.includes('at least') || e.message.includes('too long') ? 400 : 500).json({ error: e.message }); }
});

// POST /api/wallet/customer/topup
router.post('/wallet/customer/topup', async (req, res) => {
  try {
    const { customer_id, amount, source, reference, currency } = req.body;
    if (!customer_id || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    const result = await fundsSettlementService.creditCustomerWallet({
      customer_id,
      amount,
      currency: currency || 'USD',
      source: 'admin_credit',
      reference: reference || 'manual_credit',
      initiated_by: 'admin'
    });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/wallet/customer/:customerId/balance
router.get('/wallet/customer/:customerId/balance', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { currency } = req.query as any;
    const b = await walletsService.getWalletBalance(customerId, currency as string | undefined);
    res.json({ balance: Number(b.balance), currency: b.currency });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/wallet/merchant/:merchantId/balance
router.get('/wallet/merchant/:merchantId/balance', async (req, res) => {
  try {
    const { merchantId } = req.params;
    const { currency } = req.query as any;
    const wallet = await walletsService.getOrCreateMerchantWallet(merchantId, (currency as string) || 'USD');
    res.json({ balance: Number(wallet.balance), currency: wallet.currency });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/wallet/merchant/:merchantId/balances (all currencies)
router.get('/wallet/merchant/:merchantId/balances', async (req, res) => {
  try {
    const { merchantId } = req.params;
    const wallets = await walletsService.listMerchantWallets(merchantId);
    res.json({ wallets: wallets.map((w: any) => ({ balance: Number(w.balance), currency: w.currency, id: w.id })) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/wallet/customer/:customerId/balances (all currencies)
router.get('/wallet/customer/:customerId/balances', async (req, res) => {
  try {
    const { customerId } = req.params;
    const wallets = await walletsService.listCustomerWallets(customerId);
    res.json({
      wallets: wallets.map((w: any) => ({
        balance: Number(w.balance),
        currency: w.currency,
        wallet_code: w.wallet_code,
        id: w.id,
      })),
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ──────────────────────────────────────────────────────────────────────────────
// OFFLINE POS TRANSACTION LIFECYCLE — Step 3 sync endpoint
//
// POS (offline) → Local DB → SyncWorker → BACKEND (/api/pos/offline-sale)
//                                                                     ↓
//                                     1. CREDIT merchant wallet (USD/AED)
//                                     2. CREATE settlement row status='unsettled'
//                                     3. LOG explicit ledger entry POS_OFFLINE_CREDIT
//                                                                     ↓
//                                                  Merchant Wallet now has REAL USD
//
// NO DEMO APPROVALS: sync preflight runs EMV decline checks against the
// synced payload first. If ANY decline condition is met the tx is NOT credited.
// ──────────────────────────────────────────────────────────────────────────────
router.post('/pos/offline-sale', async (req, res) => {
  return res.status(501).json({
    ok: false,
    error: 'LIVE_PROCESSOR_REQUIRED: direct offline-sale accounting is disabled. Submit a signed Protocol 201.3 batch for processor verification.'
  });
  // Disabled legacy implementation retained below for reference; unreachable.
  try {
    const body = req.body;
    const merchantId = body.merchant_id || body.merchantId;
    if (!merchantId) return res.status(400).json({ error: 'merchant_id required' });

    // ── Decline preflight — single source of truth from offline-decline-preflight module
    //    NO MOCK APPROVALS. If any decline condition is hit, do NOT credit wallet.
    const results: Array<{
      stan?: string; rrn?: string; amount: number; currency: string;
      settlement_id?: string; ledger_entry_id?: string;
      merchant_wallet_balance_after?: number;
      declined?: boolean; decline_reason?: string; decline_code?: string;
    }> = [];

    const processTxn = async (txn: any) => {
      const amount = Number(txn.amount);
      if (!amount || amount <= 0) throw new Error('invalid amount');
      const txnCurrency = String(txn.currency || txn.ccy || 'USD').toUpperCase().trim();
      const stan = txn.stan || null;
      const rrn = txn.rrn || null;
      const card_masked = txn.card_masked || txn.panMasked || null;
      const entry_mode = txn.entryMode || txn.entry_mode || txn.entry_mode_code || (txn.emv || txn.tlvRaw ? 'CHIP' : 'MANUAL');
      const local_txn_id = txn.local_txn_id || txn.localTxnId || null;
      const terminal_id = txn.terminal_id || txn.terminalId || null;

      // ── PREFLIGHT (HARD DECLINE FIRST — NO MOCK / NO DEMO APPROVAL) ──
      //    Priority: real PAN from POS (if available) over masked PAN for Luhn/format checks.
      const preflight = syncOfflinePreflight({
        amountMinor: Math.round(amount * 100),
        currency: txnCurrency,
        pan: txn.pan || txn.PAN || card_masked || undefined,
        expiry: txn.expiry || txn.EXPIRY || txn.exp || undefined,
        cvv: txn.cvv || txn.CVV || undefined,
        emv: txn.emv,
        terminalId: terminal_id,
        merchantId,
        stan: stan || undefined,
      });
      if (preflight.declined) {
        results.push({
          stan: stan || undefined,
          rrn: rrn || undefined,
          amount,
          currency: txnCurrency,
          declined: true,
          decline_code: preflight.code,
          decline_reason: preflight.reason,
        });
        return;
      }

      // Step 1: Credit merchant wallet
      const creditResult = await walletsService.creditMerchantWallet(
        merchantId, amount, 'pos_offline', rrn || stan || local_txn_id, txnCurrency
      );

      // Step 2: Explicit ledger entry (per flowchart "Logs ledger entry")
      const { createLedgerEntry, validateTransition, persistLedgerEntry } = await import('../ledger/ledger.service');
      const { v4: uuidv4 } = await import('uuid');
      const ledgerId = creditResult.ledgerEntryId || uuidv4();
      const explicitLedger = createLedgerEntry(
        ledgerId,
        'credit',
        amount,
        txnCurrency,
        'SETTLED',
        `POS_OFFLINE_SYNC — merchant wallet credited after sync`
      );
      try {
        validateTransition('PENDING', explicitLedger.status as any);
        await persistLedgerEntry(explicitLedger, db.query.bind(db));
      } catch (_e_ledger) { /* idempotent */ }

      // Step 3: Settlement row = 'unsettled' until real bank money arrives
      const settlementId = uuidv4();
      const settlementMeta = JSON.stringify({
        stan, rrn, card_masked,
        entry_mode,
        local_txn_id,
        terminal_id,
      });
      await db.query(
        `INSERT INTO merchant_pos_settlements
         (id, merchant_id, ledger_entry_id, amount, currency, status, created_at, meta)
         VALUES (?, ?, ?, ?, ?, 'unsettled', CURRENT_TIMESTAMP, ?)`,
        [settlementId, merchantId, explicitLedger.id, amount, txnCurrency, settlementMeta]
      );

      const walletBalanceQ = await db.query(
        'SELECT balance FROM merchant_wallets WHERE merchant_id = ? AND currency = ?',
        [merchantId, txnCurrency]
      );
      const finalBalance = Number(walletBalanceQ.rows?.[0]?.balance ?? creditResult.balanceAfter ?? 0);

      results.push({
        stan: stan || undefined,
        rrn: rrn || undefined,
        amount,
        currency: txnCurrency,
        settlement_id: settlementId,
        ledger_entry_id: explicitLedger.id,
        merchant_wallet_balance_after: finalBalance,
      });
    };

    if (Array.isArray(body.transactions)) {
      for (const t of body.transactions) await processTxn(t);
    } else {
      await processTxn(body);
    }

    const declined = results.filter(r => r.declined).length;
    const credited = results.length - declined;
    res.json({
      ok: declined === 0,
      synced: results.length,
      credited,
      declined,
      results,
    });
  } catch (e: any) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ──────────────────────────────────────────────────────────────────────────────
// CRYPTO PURCHASE + SETTLEMENT FLOW (Step 3 of flowchart)
//
// Merchant Wallet USD ──Buy Crypto──▶ /api/merchant/:id/crypto/purchase
//                                            ↓
//                          1. DEBIT merchant USD wallet via walletsService
//                          2. CALL Binance / Bybit / OKX / Custom API
//                          3. CREDIT merchant crypto balance (UPSERT asset)
//                          4. Persist fills + ledger entries
//                                            ↓
//                                  Merchant crypto balance (USDT/BTC/…)
// ──────────────────────────────────────────────────────────────────────────────
router.post('/merchant/:merchantId/crypto/purchase', async (req, res) => {
  try {
    const { merchantId } = req.params as any;
    const { amount_usd, asset, source_currency } = req.body as any;
    const sourceCurrency = String(source_currency || 'USD').toUpperCase();
    if (!amount_usd || amount_usd <= 0 || !asset) return res.status(400).json({ error: 'Invalid payload: amount_usd (>0) and asset required' });
    const targetAsset = String(asset).toUpperCase();

    const { v4: uuidv4 } = await import('uuid');
    const { createLedgerEntry, validateTransition, persistLedgerEntry } = await import('../ledger/ledger.service');
    const binanceService: any = await import('../../exchange/binance.service');

    // PRE-FLIGHT: Resolve exchange mode before touching any balances.
    let mode: 'live';
    try {
      const cfg = binanceService.getBinanceConfig ? binanceService.getBinanceConfig() : null;
      if (!cfg || cfg.mode !== 'live') throw new Error('LIVE_CRYPTO_EXCHANGE_REQUIRED: configure production exchange credentials.');
      mode = 'live';
    } catch (cfgErr: any) {
      return res.status(400).json({
        ok: false,
        blocked: true,
        mode: 'blocked',
        error: String(cfgErr?.message || cfgErr).slice(0, 800),
        hint: 'Set real production exchange credentials in backend/.env. Simulation mode is disabled.',
        provider_used: String(process.env.CRYPTO_PROVIDER || 'binance').toLowerCase(),
      });
    }

    // Check balance first via service (truth)
    const wallet = await walletsService.getOrCreateMerchantWallet(merchantId, sourceCurrency);
    if (Number(wallet.balance) < Number(amount_usd)) {
      return res.status(400).json({
        error: `Insufficient ${sourceCurrency} balance. Have ${wallet.balance}, need ${amount_usd}.`,
      });
    }

    // Atomic transaction
    await db.query('BEGIN IMMEDIATE');
    try {
      // Step 1: DEBIT merchant wallet. Writes merchant_wallet_transactions +
      // updates merchant_wallets.balance atomically. (Source of truth per flowchart.)
      const debitResult = await walletsService.debitMerchantWallet(
        merchantId, Number(amount_usd), 'merchant_crypto_purchase', `crypto_buy_${targetAsset}`, sourceCurrency
      );

      // Step 2: Ledger entry
      const ledgerId = debitResult.ledgerEntryId || uuidv4();
      const ledgerEntry = createLedgerEntry(ledgerId, 'debit', Number(amount_usd), sourceCurrency, 'SETTLED',
        `Merchant crypto purchase (${mode.toUpperCase()}): ${targetAsset}`);
      try { validateTransition('PENDING', ledgerEntry.status as any); await persistLedgerEntry(ledgerEntry, db.query.bind(db)); } catch { /* ignore */ }

      // Step 3: Call crypto provider
      let orderResult: any = null;
      let providerUsed = String(process.env.CRYPTO_PROVIDER || 'binance').toLowerCase();
      try {
        if (providerUsed === 'bybit' || providerUsed === 'okx' || providerUsed === 'binance') {
          if (providerUsed === 'bybit') {
            const mod: any = await Promise.resolve().then(() => { try { return require('../../exchange/bybit.service'); } catch { return null; } });
            const fn = mod?.bybitBuyAsset;
            if (typeof fn === 'function') { orderResult = await fn(targetAsset, Number(amount_usd)); }
            else { providerUsed = 'binance'; }
          } else if (providerUsed === 'okx') {
            const mod: any = await Promise.resolve().then(() => { try { return require('../../exchange/okx.service'); } catch { return null; } });
            const fn = mod?.okxBuyAsset;
            if (typeof fn === 'function') { orderResult = await fn(targetAsset, Number(amount_usd)); }
            else { providerUsed = 'binance'; }
          }
          if (!orderResult && providerUsed === 'binance') {
            const { buyAssetWithUsd } = await import('../../exchange/binance.service');
            orderResult = await buyAssetWithUsd(targetAsset, Number(amount_usd));
          }
        } else if (providerUsed === 'custom') {
          const { purchaseCryptoWithCustomApi } = await import('../../exchange/custom-crypto.service');
          orderResult = await purchaseCryptoWithCustomApi(targetAsset, Number(amount_usd), merchantId);
        } else {
          // Default fallback
          const { buyAssetWithUsd } = await import('../../exchange/binance.service');
          orderResult = await buyAssetWithUsd(targetAsset, Number(amount_usd));
          providerUsed = 'binance';
        }
      } catch (ex) {
        try { await db.query('ROLLBACK'); } catch { /* ignore */ }
        try { await walletsService.creditMerchantWallet(merchantId, Number(amount_usd), 'rollback_crypto_purchase_failed', undefined, sourceCurrency); } catch { /* swallow */ }
        throw new Error(String((ex as any)?.message || 'Exchange failure').slice(0, 280));
      }

      // Step 4: Determine executed qty + is_mock flag from result
      if (orderResult?.mock === true || orderResult?.is_mock === true) {
        throw new Error('LIVE_CRYPTO_EXCHANGE_REQUIRED: provider returned a simulated result.');
      }
      const isMock = false;
      const executedQtyRaw =
        (orderResult && (typeof orderResult.executedQty === 'string' || typeof orderResult.executedQty === 'number')) ? Number(orderResult.executedQty) :
        Array.isArray(orderResult?.fills) ? orderResult.fills.reduce((s: number, f: any) => s + Number(f?.qty || 0), 0) :
        orderResult?.filled ? Number(orderResult.filled) :
        0;
      const executedQty = executedQtyRaw || 0;
      const avgPrice = executedQty ? (Number(amount_usd) / executedQty) : null;

      // Step 5: UPSERT merchant_crypto_balances (1 row per merchant+asset, add qty)
      if (executedQty > 0) {
        const existingQ = await db.query(
          'SELECT id, amount FROM merchant_crypto_balances WHERE merchant_id = ? AND asset = ? LIMIT 1',
          [merchantId, targetAsset]
        );
        if (existingQ.rows?.length) {
          const row = existingQ.rows[0];
          const newAmt = Number(row.amount) + executedQty;
          const newMeta = Object.assign({}, row.meta ? (typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta) : {}, {
            is_mock: isMock,
            mode,
            last_buy: {
              orderResult, provider: providerUsed, is_mock: isMock, mode,
              spent: amount_usd, received: executedQty, avg_price: avgPrice, at: new Date().toISOString(),
            }
            // Disabled legacy implementation marker.
          });
          await db.query(
            'UPDATE merchant_crypto_balances SET amount = ?, meta = ?, is_mock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [newAmt, JSON.stringify(newMeta), isMock ? 1 : 0, row.id]
          );
        } else {
          await db.query(
            `INSERT INTO merchant_crypto_balances (id, merchant_id, asset, amount, meta, is_mock, created_at)
             VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [
              uuidv4(), merchantId, targetAsset, executedQty,
              JSON.stringify({
                provider: providerUsed,
                is_mock: isMock,
                mode,
                last_buy: { is_mock: isMock, mode, spent: amount_usd, received: executedQty, avg_price: avgPrice, at: new Date().toISOString() },
                orderResult,
              }),
              isMock ? 1 : 0,
            ]
          );
        }
      }

      // Credit-change ledger entry on crypto side
      const cryptoLedger = createLedgerEntry(
        uuidv4(), 'credit', executedQty, targetAsset, 'SETTLED',
        `Merchant crypto ${targetAsset} received via ${providerUsed} [${mode.toUpperCase()}] after USD debit.`
      );
      try { validateTransition('PENDING', cryptoLedger.status as any); await persistLedgerEntry(cryptoLedger, db.query.bind(db)); } catch { /* ignore */ }

      await db.query('COMMIT');

      // Return balances
      const allCryptoQ = await db.query(
        'SELECT asset, amount, is_mock FROM merchant_crypto_balances WHERE merchant_id = ? ORDER BY asset',
        [merchantId]
      );
      const allFiatQ = await db.query('SELECT currency, balance FROM merchant_wallets WHERE merchant_id = ? ORDER BY currency', [merchantId]);

      res.json({
        ok: true,
        mode,
        is_mock: isMock,
        provider_used: providerUsed,
        asset: targetAsset,
        amount_spent_usd: Number(amount_usd),
        asset_received: executedQty,
        avg_price_per_unit: avgPrice,
        exchange_order: orderResult || null,
        merchant_fiat_balances: (allFiatQ.rows || []).map((r: any) => ({ currency: r.currency, balance: Number(r.balance) })),
        merchant_crypto_balances: (allCryptoQ.rows || []).map((r: any) => ({
          asset: r.asset, balance: Number(r.amount), is_mock: Number(r.is_mock) === 1
        })),
      });
    } catch (err: any) {
      try { await db.query('ROLLBACK'); } catch (_) { /* ignore */ }
      try { await walletsService.creditMerchantWallet(merchantId, Number(amount_usd), 'rollback_db_tx', undefined, sourceCurrency); } catch { /* swallow */ }
      console.error('[merchant crypto purchase rollback]', err);
      res.status(500).json({ error: String(err?.message || err).slice(0, 500) });
    }
  } catch (e: any) { console.error(e); res.status(500).json({ error: e.message }); }
});

// GET /api/merchant/:merchantId/crypto/balances → all merchant crypto assets
router.get('/merchant/:merchantId/crypto/balances', async (req, res) => {
  try {
    const { merchantId } = req.params;
    const rowsQ = await db.query(
      'SELECT id, asset, amount, is_mock, meta, created_at, updated_at FROM merchant_crypto_balances WHERE merchant_id = ? ORDER BY asset',
      [merchantId]
    );
    const rows = (rowsQ.rows || []).map((r: any) => ({
      id: r.id, asset: r.asset, balance: Number(r.amount || 0),
      is_mock: Number(r.is_mock) === 1,
      source_meta: r.meta ? (typeof r.meta === 'string' ? (() => { try { return JSON.parse(r.meta); } catch { return null; } })() : r.meta) : null,
      created_at: r.created_at, updated_at: r.updated_at,
    }));
    res.json({ merchant_id: merchantId, balances: rows });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Wallet card lookup by wallet_code
router.get('/wallet/card/:walletCode', async (req, res) => {
  try {
    const { walletCode } = req.params;
    const result = await db.query(
      `SELECT cw.balance, cw.currency, cw.wallet_code, c.name AS customer_name, c.id AS customer_id
       FROM customer_wallets cw
       LEFT JOIN customers c ON cw.customer_id = c.id
       WHERE cw.wallet_code = ?`,
      [walletCode]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Wallet not found' });
    const r = result.rows[0];
    res.json({ wallet_code: r.wallet_code, balance: Number(r.balance), currency: r.currency, customer_name: r.customer_name, customer_id: r.customer_id });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
