import express, { Request, Response, NextFunction } from "express";
import cors, { type CorsOptions } from "cors";
import path from "path";
import { db } from "./config/db";
import { buildCorsOptions } from "./config/cors";
import { authenticateToken } from "./middleware/auth.middleware";
import { terminalsRouter } from "./domain/terminals/terminals.router";
import { transactionsRouter } from "./domain/transactions/transactions.router";
import { productsRouter } from "./domain/products/products.router";
import { authRouter } from "./domain/auth/auth.router";
import { settingsRouter } from "./domain/settings/settings.router";
import { batchesRouter } from "./domain/batches/batches.router";
import { batchesController } from "./domain/batches/batches.controller";
import { terminalsController } from "./domain/terminals/terminals.controller";
import { paymentsRouter } from "./domain/payments/payments.router";
import { cardAuthRouter } from "./domain/payments/cardAuth.router";
import { receiptsRouter } from "./domain/receipts/receipts.router";
import { walletsRouter } from "./domain/wallets/wallets.router";
import cryptoWalletsRouter from "./routes/crypto-wallets.router";
import apiRouter from "./domain/api/api.router";
import payoutBankRouter from './domain/payouts/bank.router';
import payoutCryptoRouter from './domain/payouts/crypto.router';
import { mt103Router } from './domain/payouts/mt103.router';
import settlementsRouter from './domain/settlements/settlements.router';
import { conflictResolutionRouter } from './domain/conflicts/conflict-resolution.router';
import { auditTrailRouter } from './domain/audit/audit-trail.router';
import { dashboardRouter } from './domain/dashboard/dashboard.router';
import { bankTransferRouter } from './domain/banktransfer/bank-transfer.router';
import { batchFileRouter } from './domain/batchfile/batchfile.router';
import { cashoutsRouter } from "./domain/cashouts/cashouts.router";
import { paymentReceiverRouter } from "./domain/paymentreceiver/paymentreceiver.router";
import { walletTransferRouter } from "./routes/wallet-transfer.router";
import vaultRouter from './domain/vault/vault.router';
import posRouter from './pos/pos.router';
import pos1011ReconRouter from './recon/pos1011ReconRouter';
import unifiedPayoutsRouter from './domain/payouts/payouts.router';
import ledgerRouter from './domain/ledger/ledger.router';
import fundingWebhookRouter from './domain/wallets/funding-webhook.router';
import vaultGatewayRouter from './domain/vault/gateway/vault-gateway.router';
import { payoutsRouter as corePayoutsRouter } from './routes/payouts';
import { accountsRouter as coreAccountsRouter } from './routes/accounts';
import { beneficiariesRouter as coreBeneficiariesRouter } from './routes/beneficiaries';
import { walletCardsRouter } from './routes/walletCards';
import { cardTokensRouter } from './routes/cardTokens';
import { issuerProcessorRouter } from './issuer/issuerProcessor.router';
import { approvalCodeRouter } from './domain/payments/approvalCode.router';
import processorIdentityRouter from './routes/processorIdentity.router';
import dwollaRouter from './domain/payouts/dwolla.router';
import bankPartnerWebhookRouter from './domain/payouts/bank-partner-webhook.router';
import developerIntegrationRouter from './domain/developer/developer-integration.router';
import { prismaLaposRouter } from './domain/payments/prisma-lapos/prisma-lapos.router';
import { cardTopupRouter } from './domain/vault/cardTopup.router';

export const app = express();

// â”€â”€ CORS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const corsOptions: CorsOptions = buildCorsOptions();
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

const vaultWebhookJsonParser = express.json({
  limit: '1mb',
  verify: (req, _res, body) => {
    if ((req as Request).originalUrl.split('?')[0] === '/api/vault/bank/incoming-credit') {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(body);
    }
  },
});

// Internal vault-bank gateway: authenticates with its own API key/HMAC contract.
// Mount before the application JWT middleware below.
app.use('/api/vault-bank', express.json({ limit: '1mb' }), vaultGatewayRouter);
app.use('/api/vault', vaultWebhookJsonParser, bankPartnerWebhookRouter);
app.use('/api/dwolla', express.json({ limit: '1mb' }), dwollaRouter);

// â”€â”€ Simple in-memory rate limiter (no extra dependencies) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function loginRateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const entry = loginAttempts.get(key);

  if (entry && now < entry.resetAt) {
    if (entry.count >= 10) {
      return res.status(429).json({
        error: "Too many login attempts. Try again in 15 minutes."
      });
    }
    entry.count++;
  } else {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
  }
  next();
}

// â”€â”€ Body parser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Payment webhook and processor endpoints may require raw body handling for specific routes
app.use("/merchant/v1/payments/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "10mb" }));

// â”€â”€ Public routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use("/auth/login", loginRateLimiter);
app.use("/auth", authRouter);

// â”€â”€ Health checks (public) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get("/", (_req, res) => {
  return res.json({
    status: "ok",
    service: "POS 201.3 Backend",
    timestamp: new Date().toISOString(),
    health_endpoints: ["GET /health", "GET /api/health"],
    auth_endpoints:  ["POST /auth/login"],
  });
});
app.get("/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));
app.get("/api/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// ── ONE-TIME SETUP: Fix protocol rules + seed operator card auth codes ────────
if (process.env.NODE_ENV !== "production" && process.env.ENABLE_LOCAL_SETUP_ENDPOINTS === "true") {
app.post("/api/admin/setup-processor", async (_req: Request, res: Response) => {
  try {
    const { db: setupDb } = await import("./config/db");
    const { v4: setupUuid } = await import("uuid");
    const now = new Date().toISOString();
    const USD = "4165989902669610";
    const EUR = "4532017123851068";

    // 1. Fix protocol rules — self-approving processor, no external acquirer
    await setupDb.query(
      "UPDATE protocol_rules SET requires_online=0, requires_offline=0, updated_at=? WHERE protocol IN ('101.1','101.6','201.3')",
      [now]
    );

    // 2. Clear stale idempotency cache
    await setupDb.query("DELETE FROM pos_idempotency");

    // 3. Seed auth codes for operator cards
    const seeds = [
      { code: "977614", protocol: "201.3", cvv: "145", card: USD },
      { code: "9834",   protocol: "201.3", cvv: "123", card: USD },
      { code: "000004", protocol: "101.1", cvv: null,  card: USD },
      { code: "977614", protocol: "201.3", cvv: "145", card: EUR },
      { code: "9834",   protocol: "201.3", cvv: "123", card: EUR },
      { code: "000004", protocol: "101.1", cvv: null,  card: EUR },
    ];
    const inserted: string[] = [];
    for (const s of seeds) {
      const ex = await setupDb.query(
        "SELECT id FROM card_authorizations WHERE card_number=? AND protocol=? AND UPPER(code)=UPPER(?)",
        [s.card, s.protocol, s.code]
      );
      if (ex.rows.length === 0) {
        await setupDb.query(
          "INSERT INTO card_authorizations (id,card_number,protocol,code,cvv,amount,currency,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
          [setupUuid(), s.card, s.protocol, s.code, s.cvv || null, 0, "USD", "ACTIVE", now, now]
        );
        inserted.push(`${s.protocol}:${s.code}`);
      } else {
        await setupDb.query(
          "UPDATE card_authorizations SET status='ACTIVE', cvv=?, updated_at=? WHERE card_number=? AND protocol=? AND UPPER(code)=UPPER(?)",
          [s.cvv || null, now, s.card, s.protocol, s.code]
        );
      }
    }

    // 0. Inject acquirer config into running process.env (survives module caching)
    if (!process.env.ACQUIRER_HOST?.trim()) {
      process.env.ACQUIRER_HOST     = '127.0.0.1';
      process.env.ACQUIRER_PORT     = '9000';
      process.env.ACQUIRER_PROTOCOL = 'iso8583-tcp';
      process.env.PROCESSOR_MODE    = 'online';
      console.log('[Setup] Injected ACQUIRER_HOST=127.0.0.1:9000 iso8583-tcp into process.env');
    }

    // 3b. Terminal identity columns migration
    try {
      const termCols = (await setupDb.query("PRAGMA table_info('terminals')")).rows.map((r: any) => String(r.name));
      const termMigrations: Array<[string, string]> = [
        ['activation_code', 'TEXT'], ['model', 'TEXT'], ['version', 'TEXT'],
        ['ip_address', 'TEXT'], ['imei', 'TEXT'], ['imsi', 'TEXT'],
        ['activated', 'INTEGER DEFAULT 0'], ['activated_at', 'TEXT'], ['registered_by', 'TEXT'],
      ];
      for (const [col, colType] of termMigrations) {
        if (!termCols.includes(col)) {
          try { await setupDb.query('ALTER TABLE terminals ADD COLUMN ' + col + ' ' + colType); } catch { /* already exists */ }
        }
      }
    } catch { /* non-critical */ }

    // 4. Ensure emv_atc table
    await setupDb.query(`
      CREATE TABLE IF NOT EXISTS emv_atc (
        pan_last4  TEXT PRIMARY KEY,
        atc        INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 5. Verify
    const rules = await setupDb.query("SELECT protocol,requires_online,requires_offline FROM protocol_rules");
    const codes = await setupDb.query(
      "SELECT code,protocol,status,card_number FROM card_authorizations WHERE card_number IN (?,?) AND code IN ('000004','977614','9834') ORDER BY protocol,code",
      [USD, EUR]
    );

    return res.json({
      ok: true,
      rulesFixed: (rules.rows as any[]).map((r: any) => `${r.protocol} online=${r.requires_online} offline=${r.requires_offline}`),
      codesInserted: inserted,
      codesActive: (codes.rows as any[]).map((r: any) => `${r.protocol}:${r.code}:${r.card_number.slice(-4)}:${r.status}`),
      idempotencyCleared: true,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});
}


// â”€â”€ Terminal verify test endpoint (public, GET only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get("/merchant/v1/terminal/verify", (_req, res) => {
  res.json({ status: "ok", message: "Use POST to verify credentials." });
});
app.get("/merchant/v1", (_req, res) => {
  res.json({ status: "ok", message: "Merchant API v1" });
});

// â”€â”€ Public terminal register/verify (Android POS app â€” no JWT needed) â”€â”€â”€â”€â”€â”€â”€â”€
app.post("/merchant/v1/terminal/register", terminalsController.register.bind(terminalsController));
app.post("/merchant/v1/terminal/verify", terminalsController.verify.bind(terminalsController));

// â”€â”€ Standalone redeem (public, HMAC)
app.post("/api/payment2013/redeem", batchesController.redeemPaymentCode.bind(batchesController));

// â”€â”€ POS standalone batch upload and settlement endpoints (public, HMAC-protected)
//    NOTE: Previous public alias /api/pos/offline-sale has been REMOVED to avoid
//    conflict with the new JWT-authenticated dashboard SyncWorker endpoint at
//    /api/pos/offline-sale (inside api/router, flowchart-compliant).
//    Airgapped/Protocol 201.3 (HMAC public) clients now use these two alternatives:
app.post("/merchant/v1/api/payment2013/batch", batchesController.processOfflineBatch.bind(batchesController));
app.post("/merchant/v1/pos/201.3/offline-batch", batchesController.processOfflineBatch.bind(batchesController));
app.post("/merchant/v1/api/payment2013/redeem", batchesController.redeemPaymentCode.bind(batchesController));
app.post("/merchant/v1/pos/201.3/redeem", batchesController.redeemPaymentCode.bind(batchesController));
app.post("/merchant/v1/api/payment2013/verify", batchesController.verifyCredentials.bind(batchesController));

// â”€â”€ Payment router with card reader and processor endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use("/merchant/v1/payments", paymentsRouter);

// â”€â”€ Card Authorization â€” protocol validation (101.1 / 101.6 / 201.3) â”€â”€â”€â”€â”€
app.use("/api/card-auth", cardAuthRouter);

// â”€â”€ Public funding webhook endpoint
app.use('/webhooks', fundingWebhookRouter);

// â”€â”€ Public webhook endpoint for Transak order events (HMAC-signed)
app.post('/webhooks/transak', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    const transak = await import('./exchange/transak.service');
    const signature = (req.headers['x-transak-signature'] || req.headers['x-signature'] || '') as string;
    const rawBody = (req as any).rawBody || req.body;
    const payload = typeof rawBody === 'string'
      ? rawBody
      : Buffer.isBuffer(rawBody)
        ? rawBody.toString('utf8')
        : JSON.stringify(req.body);

    const webhookSecret = process.env.TRANSAK_WEBHOOK_SECRET?.trim() || '';
    if (!webhookSecret) {
      return res.status(503).json({ ok: false, error: 'Transak webhook secret is not configured' });
    }
    const verified = transak.verifyWebhookSignature(payload, signature, webhookSecret);
    if (!verified) {
      return res.status(401).json({ ok: false, error: 'Invalid Transak webhook signature' });
    }

    const event: any = typeof req.body === 'object' && !Buffer.isBuffer(req.body)
      ? req.body
      : (() => { try { return JSON.parse(payload); } catch { return {}; } })();

    const { db } = await import('./config/db');
    try {
      await db.query(
        `INSERT INTO transak_webhook_log
         (event_id, event_name, order_id, status, verified, raw_payload, signature, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          event?.id || `evt-${Date.now()}`,
          event?.eventName || event?.event || event?.type || 'UNKNOWN',
          event?.orderId || event?.order_id || event?.data?.id || null,
          event?.status || event?.data?.status || 'RECEIVED',
          verified ? 1 : 0,
          payload.substring(0, 8000),
          signature.substring(0, 256),
        ]
      );
    } catch { /* table may not exist in older schemas â€” ignore */ }

    if (event?.orderId) {
      try {
        const status = event?.status || event?.data?.status || '';
        const partnerCustomerId = event?.partnerCustomerId || event?.data?.partnerCustomerId;
        const fiatAmount = Number(event?.fiatAmount || event?.data?.fiatAmount || 0);
        const cryptoAmount = Number(event?.cryptoAmount || event?.data?.cryptoAmount || 0);
        const coin = (event?.cryptoCurrency || event?.data?.cryptoCurrency || 'USDT').toUpperCase();

        if (partnerCustomerId && (status === 'COMPLETED' || status === 'SUCCESSFUL')) {
          try {
            const walletsSvc = await import('./domain/wallets/wallets.service');
            const { v4: uuidv4 } = await import('uuid');
            const alreadyCredited = await db.query(
              `SELECT id FROM crypto_transactions
               WHERE reference IN (?, ?) AND status = 'completed'
               LIMIT 1`,
              [event?.orderId, `transak:${event?.orderId}`]
            );
            if (alreadyCredited.rows?.length) {
              return res.status(200).json({ ok: true, verified: true, acknowledged: true, duplicate: true });
            }
            if (fiatAmount > 0) {
              await walletsSvc.walletsService.topupWallet(
                partnerCustomerId, fiatAmount, 'transak_onramp',
                event?.orderId || event?.data?.partnerOrderId || event?.id,
                (event?.fiatCurrency || event?.data?.fiatCurrency || 'USD').toUpperCase()
              );
            }
            if (cryptoAmount > 0) {
              const cryptoWallet = await walletsSvc.walletsService.getOrCreateCryptoWallet(partnerCustomerId, coin);
              await db.query(
                'UPDATE customer_crypto_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [cryptoAmount, cryptoWallet.id]
              );
              try {
                await db.query(
                  `INSERT INTO crypto_transactions (id, customer_id, crypto_coin, transaction_type, fiat_amount, crypto_amount, fiat_currency, exchange_rate, source, provider_mode, status, reference)
                   VALUES (?, ?, ?, 'buy', ?, ?, ?, ?, 'transak_webhook', 'transak', 'completed', ?)`,
                  [
                    uuidv4(),
                    partnerCustomerId,
                    coin,
                    fiatAmount,
                    cryptoAmount,
                    (event?.fiatCurrency || event?.data?.fiatCurrency || 'USD').toUpperCase(),
                    fiatAmount > 0 && cryptoAmount > 0 ? fiatAmount / cryptoAmount : 0,
                    event?.orderId || event?.id || null,
                  ]
                );
              } catch { /* ignore tx insert errors */ }
            }
          } catch { /* topup/credit failures logged but webhook ACK to avoid retries */ }
        }
      } catch { /* ignore */ }
    }

    res.status(200).json({ ok: true, verified, acknowledged: true });
  } catch (e: any) {
    console.error('[Transak Webhook Error]', e?.message || e);
    res.status(200).json({ ok: true, error: 'acknowledged' });
  }
});

// â•â• ALL ROUTES BELOW REQUIRE AUTHENTICATION â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Local-only test endpoint; never expose balances or wallet records in production.
if (process.env.NODE_ENV !== "production" && process.env.ENABLE_LOCAL_SETUP_ENDPOINTS === "true") {
app.get("/test/merchant-balance/:merchantId", async (req, res) => {
  try {
    const { merchantId } = req.params;
    const result = await db.query(
      'SELECT * FROM merchant_wallets WHERE merchant_id = ? AND currency = ?',
      [merchantId, 'USD']
    );
    if (result.rows.length === 0) {
      return res.json({ error: 'Wallet not found', merchantId, balance: 0 });
    }
    const wallet = result.rows[0] as any;
    res.json({
      success: true,
      merchantId,
      balance: Number(wallet.balance || 0),
      currency: wallet.currency,
    });
  } catch (e: any) {
    console.error('[TEST] Error:', e);
    res.status(500).json({ error: e.message });
  }
});
}
// â”€â”€ Coin / crypto logos (public â€” no auth required) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use('/coins', express.static(path.join(__dirname, '..', 'public')));

app.use(authenticateToken);

// Wallet routes
app.use("/wallet", walletsRouter);
app.use('/api/crypto', cryptoWalletsRouter);
app.use('/api/wallet-transfer', walletTransferRouter);

// API routes (contract)
app.use('/api', apiRouter);
app.use('/api/payout', payoutBankRouter);
app.use('/api/payout/mt103', mt103Router);
app.use('/api', payoutCryptoRouter);
app.use('/api', settlementsRouter);
app.use('/api/conflicts', conflictResolutionRouter);
app.use('/api/audit', auditTrailRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/bank-transfer', bankTransferRouter);
app.use('/api/vault', vaultRouter);
app.use('/api/pos', posRouter);
app.use('/api/reconciliation', pos1011ReconRouter);
app.use('/api/batch-file', batchFileRouter);
app.use('/api/payouts', unifiedPayoutsRouter);
// Public API resource aliases; the existing /api/* paths remain supported.
app.use('/payouts', unifiedPayoutsRouter);
app.use('/', vaultRouter);
app.use('/api/ledger', ledgerRouter);
app.use('/ledger', ledgerRouter);

// â”€â”€ Core Payouts API (spec-aligned standalone tables) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//    JWT-protected (mounted after authenticateToken above).
//    Use /v2/* or /core/* prefix to avoid conflicts with the vault-integrated
//    payouts API at /payouts and /api/payouts.
app.use('/v2/payouts', corePayoutsRouter);
app.use('/v2/accounts', coreAccountsRouter);
app.use('/v2/beneficiaries', coreBeneficiariesRouter);
app.use('/core/payouts', corePayoutsRouter);
app.use('/core/accounts', coreAccountsRouter);
app.use('/core/beneficiaries', coreBeneficiariesRouter);

app.use('/wallet-cards', walletCardsRouter);
app.use('/v2/wallet-cards', walletCardsRouter);
app.use('/api/wallet-cards', walletCardsRouter);
app.use('/api/card-tokens', cardTokensRouter);
app.use('/api/issuer', issuerProcessorRouter);
app.use('/api/approval-code', approvalCodeRouter);
app.use('/api/processor', processorIdentityRouter);
app.use('/api/developer', developerIntegrationRouter);
app.use('/api/prisma-pos', express.json({ limit: '1mb' }), prismaLaposRouter);
app.use('/api/card-topup', express.json({ limit: '1mb' }), cardTopupRouter);


// ── POST /api/wallets/customer-to-merchant ──────────────────────────────────
app.post('/api/wallets/customer-to-merchant', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { customerId, merchantId, amount, currency, providerUrl, providerApiKey, providerSecretKey, reference } = req.body || {};
    if (!customerId || !merchantId || !amount || !providerUrl || !providerApiKey || !providerSecretKey) {
      return res.status(400).json({ ok: false, error: 'customerId, merchantId, amount, providerUrl, providerApiKey, and providerSecretKey required' });
    }
    const amt = Number(amount);
    const ccy = String(currency || 'USD').toUpperCase().trim();
    const ref = String(reference || `C2M-${Date.now().toString(36).toUpperCase()}`).trim();
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ ok: false, error: 'amount must be positive' });
    if (!/^[A-Z]{3}$/.test(ccy)) return res.status(400).json({ ok: false, error: 'currency must be a three-letter ISO code' });
    if (!ref || ref.length > 180) return res.status(400).json({ ok: false, error: 'reference must be 1 to 180 characters' });

    // Call provider to pull real funds
    let urlParsed: URL;
    try {
      urlParsed = new URL(String(providerUrl));
    } catch {
      return res.status(400).json({ ok: false, error: 'providerUrl must be a valid HTTPS URL' });
    }
    const isHttps   = urlParsed.protocol === 'https:';
    if (!isHttps || urlParsed.username || urlParsed.password) {
      return res.status(400).json({ ok: false, error: 'Provider endpoint must use HTTPS and must not contain embedded credentials' });
    }
    const { db: wDb } = await import('./config/db');
    const { v4: wUuid } = await import('uuid');
    await wDb.query(`
      CREATE TABLE IF NOT EXISTS customer_provider_transfers (
        reference TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        provider_reference TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      )
    `);
    const existingTransfer = (await wDb.query(
      'SELECT status FROM customer_provider_transfers WHERE reference = ?',
      [ref],
    )).rows[0] as { status?: string } | undefined;
    if (existingTransfer) {
      return res.status(409).json({ ok: false, error: `Transfer reference already used (${existingTransfer.status || 'UNKNOWN'}); use a new reference` });
    }
    const now = new Date().toISOString();
    const txnId = wUuid();
    await wDb.query(
      `INSERT INTO customer_provider_transfers
        (reference, merchant_id, customer_id, amount, currency, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`,
      [ref, merchantId, customerId, amt, ccy, now],
    );
    const bodyStr = JSON.stringify({
      customerId, merchantId,
      amount: amt, currency: ccy,
      reference: ref, action: 'withdraw',
    });

    const axios = await import('axios');
    const providerClient = axios.default.create({
      headers: {
        'Content-Type':   'application/json',
        'Idempotency-Key': String(ref),
        'Authorization':  `Bearer ${String(providerApiKey)}`,
        'X-Api-Key':      String(providerApiKey),
        'X-Secret-Key':   String(providerSecretKey),
        'X-Api-Secret':   String(providerSecretKey),
      },
    });

    let providerData: any = {};
    let providerHttpStatus = 0;

    try {
      const resp = await providerClient.post(
        String(providerUrl),
        JSON.parse(bodyStr),
        { timeout: 20000, maxRedirects: 0, validateStatus: () => true },
      );
      providerHttpStatus = resp.status;
      providerData       = resp.data || {};
    } catch (axErr: any) {
      await wDb.query(
        "UPDATE customer_provider_transfers SET status='FAILED' WHERE reference=?",
        [ref],
      );
      const msg = axErr?.code === 'ECONNREFUSED'
        ? `Cannot reach provider endpoint (connection refused)`
        : axErr?.code === 'ETIMEDOUT' || axErr?.code === 'ECONNABORTED'
          ? 'Provider did not respond within 20 seconds'
          : axErr?.message || 'Provider request failed';
      return res.status(502).json({ ok: false, error: msg });
    }

    // ── Provider response validation ────────────────────────────────────────
    // Accept any 2xx. Real providers return wildly different status strings.
    // We treat any non-4xx/5xx HTTP as a confirmed debit.
    // If the provider explicitly returns an error status field we honour it.
    const isHttpSuccess = providerHttpStatus >= 200 && providerHttpStatus < 300;
    if (!isHttpSuccess) {
      await wDb.query(
        "UPDATE customer_provider_transfers SET status='FAILED' WHERE reference=?",
        [ref],
      );
      const errMsg = providerData?.error
        || providerData?.message
        || providerData?.msg
        || `Provider rejected with HTTP ${providerHttpStatus}`;
      console.warn(`[C2M] Provider rejected ref=${ref} HTTP=${providerHttpStatus}`, providerData);
      return res.status(502).json({ ok: false, error: errMsg, httpStatus: providerHttpStatus, detail: providerData });
    }

    // Check for explicit failure status in body (e.g. { "status": "FAILED", "error": "..." })
    const bodyStatus = String(
      providerData?.status || providerData?.result || providerData?.state || '',
    ).toUpperCase();
    const explicitFail = ['FAILED', 'DECLINED', 'REJECTED', 'ERROR', 'CANCELLED'].includes(bodyStatus);
    if (explicitFail) {
      await wDb.query(
        "UPDATE customer_provider_transfers SET status='FAILED' WHERE reference=?",
        [ref],
      );
      const errMsg = providerData?.error || providerData?.message || `Provider returned status: ${bodyStatus}`;
      console.warn(`[C2M] Provider explicit fail ref=${ref} status=${bodyStatus}`, providerData);
      return res.status(502).json({ ok: false, error: errMsg, providerStatus: bodyStatus });
    }

    // Extract provider's own transaction reference for audit trail
    const providerReference = String(
      providerData?.transactionId
      || providerData?.transaction_id
      || providerData?.transferId
      || providerData?.transfer_id
      || providerData?.id
      || providerData?.reference
      || providerData?.ref
      || '',
    ).slice(0, 200);

    console.log(`[C2M] Provider confirmed ref=${ref} HTTP=${providerHttpStatus} providerRef=${providerReference || '(none)'}`);
    console.log(`[C2M] Provider full response:`, JSON.stringify(providerData).slice(0, 500));

    // Credit merchant wallet
    await wDb.query('BEGIN IMMEDIATE');
    let mw: any;
    try {
      mw = (await wDb.query('SELECT id,balance FROM merchant_wallets WHERE merchant_id=? AND currency=? LIMIT 1', [merchantId, ccy])).rows[0];
      if (!mw) {
        const mwId = wUuid();
        await wDb.query('INSERT INTO merchant_wallets(id,merchant_id,balance,currency)VALUES(?,?,0,?)', [mwId, merchantId, ccy]);
        mw = { id: mwId, balance: 0 };
      }

      // ── AUTO-FUND OMNIBUS with the confirmed real funds ─────────────────────
      // The provider just confirmed real money moved. We immediately credit the
      // Omnibus so the merchant wallet credit is backed by real withdrawable funds.
      // This is the key step that makes the merchant wallet balance REAL — not a
      // ledger entry. Without this, the Omnibus gate blocks all further settlement.
      await wDb.query(`
        CREATE TABLE IF NOT EXISTS omnibus_accounts (
          account_id TEXT NOT NULL,
          currency   TEXT NOT NULL,
          balance    REAL NOT NULL DEFAULT 0,
          label      TEXT NOT NULL DEFAULT 'VAULT BANK OMNIBUS',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (account_id, currency)
        )
      `);
      await wDb.query(`
        INSERT INTO omnibus_accounts (account_id, currency, balance, label, created_at, updated_at)
        VALUES ('VAULT_BANK_OMNIBUS', ?, ?, 'VAULT BANK OMNIBUS', ?, ?)
        ON CONFLICT(account_id, currency) DO UPDATE SET
          balance    = balance + excluded.balance,
          updated_at = excluded.updated_at
      `, [ccy, amt, now, now]);

      // Dual-ledger: record Omnibus credit so audit trail shows real fund source
      await wDb.query(`
        CREATE TABLE IF NOT EXISTS vault_ledger (
          id TEXT PRIMARY KEY, ts TEXT NOT NULL, type TEXT NOT NULL,
          merchant_id TEXT, amount REAL NOT NULL, currency TEXT NOT NULL,
          reference TEXT NOT NULL, status TEXT NOT NULL, meta TEXT
        )
      `).catch(() => {});
      await wDb.query(`
        INSERT OR IGNORE INTO vault_ledger
          (id, ts, type, merchant_id, amount, currency, reference, status, meta)
        VALUES (?, ?, 'C2M_PROVIDER_REAL_FUNDS', ?, ?, ?, ?, 'COMPLETED', ?)
      `, [
        wUuid(), now, merchantId, amt, ccy, ref,
        JSON.stringify({
          source: 'c2m_provider_confirmed',
          providerRef: providerReference || null,
          customerId,
          providerUrl: urlParsed.hostname,
        }),
      ]).catch(() => {});

      // Credit merchant wallet
      await wDb.query('UPDATE merchant_wallets SET balance=balance+?,updated_at=? WHERE id=?', [amt, now, mw.id]);
      await wDb.query(`INSERT INTO merchant_wallet_transactions(id,wallet_id,type,amount,currency,source,reference,description,created_at)VALUES(?,?,?,?,?,?,?,?,?)`,
        [txnId, mw.id, 'credit', amt, ccy, 'global_server_pull', ref,
         `Real funds confirmed by provider — customer ${customerId} → merchant ${merchantId} | providerRef=${providerReference || 'none'}`, now]);
      await wDb.query(
        `UPDATE customer_provider_transfers
            SET status = 'COMPLETED', provider_reference = ?, completed_at = ?
          WHERE reference = ?`,
        [providerReference || null, now, ref],
      );
      await wDb.query('COMMIT');
    } catch (error) {
      try { await wDb.query('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }

    // Merchant wallet is credited above.
    // Vault is NOT credited here — funds only move to vault when the merchant
    // explicitly sends via POST /api/vault/merchant-transfer from the Merchant Wallet page.
    // This keeps the merchant wallet and vault as separate real-money stores.

    const newBal = Number(mw.balance) + amt;
    console.log(`[C2M] COMPLETE: ${ccy} ${amt} → merchant ${merchantId} ref=${ref} providerRef=${providerReference || 'none'}`);
    return res.json({
      ok: true,
      txnId,
      merchantId,
      customerId,
      amount: amt,
      currency: ccy,
      reference: ref,
      merchantBalanceAfter: newBal,
      providerReference: providerReference || undefined,
      creditedAt: now,
    });
  } catch (e: any) { return res.status(500).json({ ok: false, error: e.message }); }
});
// Merchant API routes
app.use("/merchant/v1", terminalsRouter);
app.use("/merchant/v1", transactionsRouter);
app.use("/merchant/v1", productsRouter);
app.use("/merchant/v1", settingsRouter);
app.use("/merchant/v1", batchesRouter);
app.use("/merchant/v1/receipts", receiptsRouter);
app.use("/merchant/v1/cashouts", cashoutsRouter);
// Internal payment receiver for standalone testing and internal integrations
app.use("/internal/payment-receiver", paymentReceiverRouter);



// â”€â”€ Global error handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Error]", err.message || err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Internal server error" });
});
