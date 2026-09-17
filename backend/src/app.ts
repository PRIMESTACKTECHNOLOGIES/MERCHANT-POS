import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "path";
import { db } from "./config/db";
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

export const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim());
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("CORS: origin not allowed"), false);
  },
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Api-Key", "Idempotency-Key", "X-Signature", "X-Timestamp", "X-Nonce", "X-Merchant-Id", "X-Terminal-Id"]
}));
app.options("*", cors());

// Internal vault-bank gateway: authenticates with its own API key/HMAC contract.
// Mount before the application JWT middleware below.
app.use('/api/vault-bank', express.json({ limit: '1mb' }), vaultGatewayRouter);

// ── Simple in-memory rate limiter (no extra dependencies) ─────────────────────
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

// ── Body parser ───────────────────────────────────────────────────────────────
// Payment webhook and processor endpoints may require raw body handling for specific routes
app.use("/merchant/v1/payments/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "10mb" }));

// ── Public routes ─────────────────────────────────────────────────────────────
app.use("/auth/login", loginRateLimiter);
app.use("/auth", authRouter);

// ── Health checks (public) ────────────────────────────────────────────────────
app.get("/", (_req, res) => res.json({
  status: "ok",
  service: "POS 201.3 Backend",
  timestamp: new Date().toISOString(),
  health_endpoints: ["GET /health", "GET /api/health"],
  auth_endpoints:  ["POST /auth/login"],
}));
app.get("/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));
app.get("/api/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// ── Terminal verify test endpoint (public, GET only) ──────────────────────────
app.get("/merchant/v1/terminal/verify", (_req, res) => {
  res.json({ status: "ok", message: "Use POST to verify credentials." });
});
app.get("/merchant/v1", (_req, res) => {
  res.json({ status: "ok", message: "Merchant API v1" });
});

// ── Public terminal register/verify (Android POS app — no JWT needed) ────────
app.post("/merchant/v1/terminal/register", terminalsController.register.bind(terminalsController));
app.post("/merchant/v1/terminal/verify", terminalsController.verify.bind(terminalsController));

// ── Standalone redeem (public, HMAC)
app.post("/api/payment2013/redeem", batchesController.redeemPaymentCode.bind(batchesController));

// ── POS standalone batch upload and settlement endpoints (public, HMAC-protected)
//    NOTE: Previous public alias /api/pos/offline-sale has been REMOVED to avoid
//    conflict with the new JWT-authenticated dashboard SyncWorker endpoint at
//    /api/pos/offline-sale (inside api/router, flowchart-compliant).
//    Airgapped/Protocol 201.3 (HMAC public) clients now use these two alternatives:
app.post("/merchant/v1/api/payment2013/batch", batchesController.processOfflineBatch.bind(batchesController));
app.post("/merchant/v1/pos/201.3/offline-batch", batchesController.processOfflineBatch.bind(batchesController));
app.post("/merchant/v1/api/payment2013/redeem", batchesController.redeemPaymentCode.bind(batchesController));
app.post("/merchant/v1/pos/201.3/redeem", batchesController.redeemPaymentCode.bind(batchesController));
app.post("/merchant/v1/api/payment2013/verify", batchesController.verifyCredentials.bind(batchesController));

// ── Payment router with card reader and processor endpoints ───────────────
app.use("/merchant/v1/payments", paymentsRouter);

// ── Card Authorization — protocol validation (101.1 / 101.6 / 201.3) ─────
app.use("/api/card-auth", cardAuthRouter);

// ── Public funding webhook endpoint
app.use('/webhooks', fundingWebhookRouter);

// ── Public webhook endpoint for Transak order events (HMAC-signed)
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
    } catch { /* table may not exist in older schemas — ignore */ }

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

// ══ ALL ROUTES BELOW REQUIRE AUTHENTICATION ══════════════════════════════════

// TEST ENDPOINT - Public merchant balance check (no auth)
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
    console.log('[TEST] Merchant wallet from DB:', wallet);
    res.json({ 
      success: true,
      merchantId, 
      balance: Number(wallet.balance || 0),
      currency: wallet.currency,
      balanceRaw: wallet.balance,
      wallet: wallet
    });
  } catch (e: any) {
    console.error('[TEST] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

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

// ── Core Payouts API (spec-aligned standalone tables) ────────────────────
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

// ── Serve React frontend (production) ────────────────────────────────────────
const clientBuildPath = path.join(__dirname, "public");
app.use(express.static(clientBuildPath));
// SPA fallback — any route not matched by the API returns index.html
app.get("*", (_req, res) => {
  const indexPath = path.join(clientBuildPath, "index.html");
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(200).json({ status: "ok", message: "POS 201.3 API running" });
    }
  });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Error]", err.message || err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Internal server error" });
});
