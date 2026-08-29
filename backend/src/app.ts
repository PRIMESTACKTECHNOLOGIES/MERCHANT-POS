import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
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
import { receiptsRouter } from "./domain/receipts/receipts.router";
import { walletsRouter } from "./domain/wallets/wallets.router";
import cryptoWalletsRouter from "./routes/crypto-wallets.router";
import apiRouter from "./domain/api/api.router";
import payoutBankRouter from './domain/payouts/bank.router';
import payoutCryptoRouter from './domain/payouts/crypto.router';
import settlementsRouter from './domain/settlements/settlements.router';
import afseRouter from './domain/settlements/afse.router';
import { conflictResolutionRouter } from './domain/conflicts/conflict-resolution.router';
import { auditTrailRouter } from './domain/audit/audit-trail.router';
import { dashboardRouter } from './domain/dashboard/dashboard.router';
import { bankTransferRouter } from './domain/banktransfer/bank-transfer.router';
import { batchFileRouter } from './domain/batchfile/batchfile.router';
import { wiseWebhookRouter } from './domain/payouts/wiseWebhook.router';
import { cashoutsRouter } from "./domain/cashouts/cashouts.router";
import { paymentReceiverRouter } from "./domain/paymentreceiver/paymentreceiver.router";
import { recoveryRouter } from "./domain/reconciliation/recovery.router";

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
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Signature", "X-Merchant-Id", "X-Terminal-Id"]
}));
app.options("*", cors());

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
app.get("/", (_req, res) => {
  const indexPath = path.join(__dirname, "public", "index.html");
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
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
app.post("/merchant/v1/api/payment2013/retry-captures", batchesController.retryFailedCaptures.bind(batchesController));
app.post("/merchant/v1/pos/201.3/retry-captures", batchesController.retryFailedCaptures.bind(batchesController));

// ── Public webhook endpoint for Wise payout notifications
app.use('/webhooks', wiseWebhookRouter);

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
    let verified = false;
    try {
      verified = transak.verifyWebhookSignature(payload, signature, webhookSecret);
    } catch { /* keep verified = false */ }

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

    if (verified && event?.orderId) {
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

// Diagnostic endpoints are authenticated below; never expose balances or wallet data publicly.
app.get("/test/merchant-balance/:merchantId", authenticateToken, async (req, res) => {
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

// Test endpoint: Tron hot wallet TRX + USDT balance (no auth)
app.get("/test/tron-hot-wallet", authenticateToken, async (req, res) => {
  try {
    const mod = await import('./exchange/tronweb.service');
    const addr = mod.getHotWalletAddress();
    const trx = await mod.getHotWalletTrxBalance();
    const usdt = await mod.getHotWalletUsdtBalance();
    res.json({ success: true, address: addr, trx_balance: trx, usdt_trc20_balance: usdt });
  } catch (e: any) {
    console.error('[TEST] Tron:', e);
    res.status(500).json({ error: e.message });
  }
});

// Test endpoint: dump authorization_requests rows (no auth, minimal cols, AFSE debug)
app.get("/test/authorization-requests", authenticateToken, async (req, res) => {
  try {
    const { db } = await import('./config/db');
    const r = await db.query(`
      SELECT id, authorization_code, status, amount, currency, customer_id, merchant_id,
             transaction_id, requested_at, authorized_at, settled_at, expires_at,
             transaction_type
      FROM authorization_requests
      ORDER BY COALESCE(requested_at, authorized_at) ASC
    `);
    res.json({ success: true, count: r.rowCount || 0, rows: r.rows || [] });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

// Test endpoint: dump pos2013_transactions + customer mapping (no auth)
app.get("/test/pos-transactions-cust", authenticateToken, async (req, res) => {
  try {
    const { db } = await import('./config/db');
    const r = await db.query(`
      SELECT t.id, t.auth_code, t.status, t.amount_minor, t.currency, t.card_brand,
             t.pan_masked, t.merchant_id, t.terminal_id, t.batch_id, t.local_txn_id,
             t.txn_timestamp, t.created_at,
             ar.id as auth_row_id, ar.customer_id as auth_customer_id,
             c.id as cust_id, c.name as customer_name,
             w.id as wallet_id, w.balance, w.currency as wallet_ccy, w.wallet_code
      FROM pos2013_transactions t
      LEFT JOIN authorization_requests ar ON ar.transaction_id = t.id
      LEFT JOIN customers c ON c.id = COALESCE(ar.customer_id, NULL)
      LEFT JOIN customer_wallets w ON w.customer_id = c.id
                                      AND w.currency = t.currency
      ORDER BY t.created_at ASC
    `);
    res.json({ success: true, count: r.rowCount || 0, rows: r.rows || [] });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

app.use(authenticateToken);

// Payment and diagnostic routes require JWT authentication.
app.use("/merchant/v1/payments", paymentsRouter);

// Wallet routes
app.use("/wallet", walletsRouter);
app.use('/api/crypto', cryptoWalletsRouter);

// API routes (contract)
app.use('/api', apiRouter);
app.use('/api', payoutBankRouter);
app.use('/api', payoutCryptoRouter);
app.use('/api', settlementsRouter);
app.use('/api/settlement-engine', afseRouter);
app.use('/api/conflicts', conflictResolutionRouter);
app.use('/api/audit', auditTrailRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/bank-transfer', bankTransferRouter);
app.use('/api/batch-file', batchFileRouter);

// Merchant API routes
app.use("/merchant/v1", terminalsRouter);
app.use("/merchant/v1", transactionsRouter);
app.use("/merchant/v1", productsRouter);
app.use("/merchant/v1", settingsRouter);
app.use("/merchant/v1", batchesRouter);
app.use("/merchant/v1/reconciliation", recoveryRouter);
app.use("/merchant/v1/recovery", recoveryRouter);
app.use("/merchant/v1/receipts", receiptsRouter);
app.use("/merchant/v1/cashouts", cashoutsRouter);
// Internal payment receiver for standalone testing and internal integrations
app.use("/internal/payment-receiver", paymentReceiverRouter);

// ── Serve React frontend only when enabled ───────────────────────────────────
// The API service can run without exposing the dashboard; a separate Render
// frontend service may enable this with SERVE_FRONTEND=true.
if (process.env.SERVE_FRONTEND !== 'false') {
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
} else {
  app.get("/", (_req, res) => {
    res.json({ status: "ok", message: "POS 201.3 API running" });
  });
}

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Error]", err.message || err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Internal server error" });
});
