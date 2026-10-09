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
import { transakVbaRouter } from './domain/wallets/transakVba.router';

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
app.get("/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));
app.get("/api/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// ── One-time password reset (protected by RESET_TOKEN env var) ───────────────
app.post("/api/admin/reset-password", async (req: Request, res: Response) => {
  const resetToken = (process.env.RESET_TOKEN || '').trim();
  const { token, newPassword } = req.body || {};
  if (!resetToken) return res.status(503).json({ error: 'RESET_TOKEN not configured' });
  if (token !== resetToken) return res.status(401).json({ error: 'Invalid reset token' });
  if (!newPassword || String(newPassword).length < 6) return res.status(400).json({ error: 'newPassword must be at least 6 chars' });
  try {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash(String(newPassword), 10);
    const { db: rDb } = await import('./config/db');
    await rDb.query('UPDATE admin_users SET password_hash = ? WHERE username = ?', [hash, 'admin']);
    console.log('[PasswordReset] Admin password updated successfully');
    return res.json({ ok: true, message: 'Password updated. Remove RESET_TOKEN from env after use.' });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});
const _frontendDist = (() => {
  try {
    const p = path.join(__dirname, '..', '..', 'client', 'dist');
    return require('fs').existsSync(p) ? p : null;
  } catch { return null; }
})();

const resolveAppConfigApiUrl = (): string => {
  const v = (process.env.APP_CONFIG_API_URL || process.env.VITE_API_URL || process.env.API_URL || '').trim();
  return v.replace(/\/+$/, '');
};

let _cachedIndexHtml: string | null = null;
let _cachedIndexHtmlApiUrl: string | null = null;
const serveInjectedIndexHtml = (res: Response) => {
  if (!_frontendDist) {
    return res.status(503).json({ ok: false, error: 'Frontend not built — client/dist missing' });
  }
  const fs = require('fs');
  const apiUrl = resolveAppConfigApiUrl();
  if (!_cachedIndexHtml || _cachedIndexHtmlApiUrl !== apiUrl) {
    let raw = fs.readFileSync(path.join(_frontendDist, 'index.html'), 'utf8');
    const payload = JSON.stringify({ api_url: apiUrl, built_at: new Date().toISOString() });
    const tag = `<script id="__APP_CONFIG__">window.APP_CONFIG=${payload};</script>`;
    if (raw.includes('id="__APP_CONFIG__"')) {
      raw = raw.replace(/<script id="__APP_CONFIG__">[\s\S]*?<\/script>/, tag);
    } else if (raw.includes('</head>')) {
      raw = raw.replace('</head>', tag + '\n</head>');
    } else if (raw.includes('<body')) {
      raw = raw.replace(/<body[^>]*>/, (m: string) => tag + '\n' + m);
    } else {
      raw = tag + '\n' + raw;
    }
    _cachedIndexHtml = raw;
    _cachedIndexHtmlApiUrl = apiUrl;
  }
  res.type('html');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.send(_cachedIndexHtml);
};

if ((process.env.SERVE_FRONTEND === 'true' || process.env.SERVE_FRONTEND === '1') && _frontendDist) {
  app.use(express.static(_frontendDist, {
    index: false,
    maxAge: '1d',
    immutable: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      }
    },
  }));
}

app.get("/", (req, res, next) => {
  if ((process.env.SERVE_FRONTEND === 'true' || process.env.SERVE_FRONTEND === '1') && _frontendDist) {
    return serveInjectedIndexHtml(res);
  }
  if (req.accepts('html') && (process.env.SERVE_FRONTEND === 'true' || process.env.SERVE_FRONTEND === '1')) {
    return next();
  }
  return res.json({
    status: "ok",
    service: "POS 201.3 Backend",
    timestamp: new Date().toISOString(),
    health_endpoints: ["GET /health", "GET /api/health"],
    auth_endpoints:  ["POST /auth/login"],
  });
});

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
// ── Core API routes (JWT-authenticated) ──────────────────────────────────────

// ── Legacy path aliases (frontend calls /wallet/* and /merchant/v1/* for these) ──
// These must come BEFORE the /api/* mounts so Express matches them first.
app.use('/wallet', walletsRouter);
app.use('/merchant/v1/terminals', terminalsRouter);
app.use('/merchant/v1/transactions', transactionsRouter);
app.use('/merchant/v1/settings', settingsRouter);
app.use('/merchant/v1/batches', batchesRouter);
app.use('/merchant/v1/products', productsRouter);
app.use('/merchant/v1/receipts', receiptsRouter);

app.use('/api/wallets', walletsRouter);
app.use('/api/wallets/vba', transakVbaRouter);
app.use('/api', apiRouter);
app.use('/api/vault', vaultRouter);
app.use('/api/vault/cardtopup', cardTopupRouter);
app.use('/api/settlements', settlementsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/products', productsRouter);
app.use('/api/terminals', terminalsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/batches', batchesRouter);
app.use('/api/receipts', receiptsRouter);
app.use('/api/cashouts', cashoutsRouter);
app.use('/api/payouts/bank', payoutBankRouter);
app.use('/api/payout', payoutBankRouter);          // alias: frontend uses /api/payout/*
app.use('/api/payouts/crypto', payoutCryptoRouter);
app.use('/api/payouts/mt103', mt103Router);
app.use('/api/payout/mt103', mt103Router);         // alias: frontend uses /api/payout/mt103/*
app.use('/api/payouts', unifiedPayoutsRouter);
app.use('/api/ledger', ledgerRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/bank-transfer', bankTransferRouter);
app.use('/api/batch-file', batchFileRouter);
app.use('/api/payment-receiver', paymentReceiverRouter);
app.use('/api/conflict-resolution', conflictResolutionRouter);
app.use('/api/audit', auditTrailRouter);
app.use('/api/crypto-wallets', cryptoWalletsRouter);
app.use('/api/wallet-transfer', walletTransferRouter);
app.use('/api/accounts', coreAccountsRouter);
app.use('/api/beneficiaries', coreBeneficiariesRouter);
app.use('/api/payouts', corePayoutsRouter);
app.use('/api/wallet-cards', walletCardsRouter);
app.use('/api/card-tokens', cardTokensRouter);
app.use('/api/issuer', issuerProcessorRouter);
app.use('/api/approval-codes', approvalCodeRouter);
app.use('/api/processor-identity', processorIdentityRouter);
app.use('/api/developer', developerIntegrationRouter);
app.use('/api/prisma-lapos', prismaLaposRouter);
app.use('/api/pos', posRouter);
app.use('/api/recon', pos1011ReconRouter);

// ── Transak Order Webhook (HMAC-signed) ──────────────────────────────────────
app.post('/webhooks/transak', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    const transak = await import('./exchange/transak.service');
    const signature = (req.headers['x-transak-signature'] || req.headers['x-signature'] || '') as string;
    const rawBody = (req as any).rawBody || req.body;
    const payload = typeof rawBody === 'string' ? rawBody : Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : JSON.stringify(req.body);
    const webhookSecret = process.env.TRANSAK_WEBHOOK_SECRET?.trim() || '';
    if (!webhookSecret) return res.status(503).json({ ok: false, error: 'Transak webhook secret not configured' });
    const verified = transak.verifyWebhookSignature(payload, signature, webhookSecret);
    if (!verified) return res.status(401).json({ ok: false, error: 'Invalid Transak webhook signature' });
    const rawEvent: any = typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : (() => { try { return JSON.parse(payload); } catch { return {}; } })();
    // Decode JWT data field per Transak spec
    let event: any = rawEvent;
    if (rawEvent?.data && typeof rawEvent.data === 'string') {
      try {
        const jwtLib = await import('jsonwebtoken');
        const secret = process.env.PARTNER_ACCESS_TOKEN?.trim() || process.env.TRANSAK_API_SECRET?.trim() || '';
        const decoded: any = secret ? jwtLib.verify(rawEvent.data, secret) : jwtLib.decode(rawEvent.data);
        event = { ...rawEvent, webhookData: decoded, ...(decoded || {}) };
      } catch { try { event = { ...rawEvent, ...JSON.parse(rawEvent.data) }; } catch { /* use raw */ } }
    }
    const webhookData = event?.webhookData || event;
    const eventID     = String(rawEvent?.eventID || webhookData?.eventID || '').toUpperCase();
    const orderId     = String(webhookData?.id || webhookData?.orderId || rawEvent?.orderId || '');
    const status      = String(webhookData?.status || '').toUpperCase();
    const partnerCustomerId = String(webhookData?.partnerCustomerId || webhookData?.partnerUserId || '');
    const fiatAmount  = Number(webhookData?.fiatAmount || 0);
    const cryptoAmount = Number(webhookData?.cryptoAmount || 0);
    const fiatCurrency = String(webhookData?.fiatCurrency || 'USD').toUpperCase();
    const coin        = String(webhookData?.cryptoCurrency || 'USDT').toUpperCase();
    // isBuyOrSell: 'BUY' = on-ramp (user bought crypto), 'SELL' = off-ramp (user sold crypto for fiat)
    const isBuyOrSell  = String(webhookData?.isBuyOrSell || webhookData?.productsAvailed || 'BUY').toUpperCase();
    const isOffRamp    = isBuyOrSell === 'SELL';
    const { db } = await import('./config/db');
    const { v4: uuidv4 } = await import('uuid');
    try {
      await db.query(
        `INSERT OR IGNORE INTO transak_webhook_log (event_id, event_name, order_id, status, verified, raw_payload, signature, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [orderId || `evt-${Date.now()}`, eventID || 'UNKNOWN', orderId || null, status || 'RECEIVED', verified ? 1 : 0, payload.substring(0, 8000), signature.substring(0, 256)]
      );
    } catch { /* ignore */ }
    console.log(`[Transak Webhook] eventID=${eventID} status=${status} orderId=${orderId} customer=${partnerCustomerId} flow=${isBuyOrSell}`);
    if ((eventID === 'ORDER_COMPLETED' || status === 'COMPLETED') && orderId) {
      try {
        const alreadyProcessed = await db.query(`SELECT id FROM wallet_transactions WHERE reference = ? AND source LIKE 'transak%' LIMIT 1`, [orderId]).catch(() => ({ rows: [] }));
        if (!alreadyProcessed.rows?.length) {
          const now = new Date().toISOString();
          const walletsSvc = await import('./domain/wallets/wallets.service');
          if (isOffRamp) {
            // ── OFF-RAMP (SELL): user sold crypto → Transak pays fiat directly to user's bank
            // Debit the customer's crypto wallet to reflect the sold amount.
            if (partnerCustomerId && cryptoAmount > 0) {
              try {
                const cw = await walletsSvc.walletsService.getOrCreateCryptoWallet(partnerCustomerId, coin);
                await db.query(
                  'UPDATE customer_crypto_wallets SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                  [cryptoAmount, cw.id]
                );
                await db.query(
                  `INSERT OR IGNORE INTO wallet_transactions (id, customer_id, type, amount, currency, source, reference, description, created_at) VALUES (?, ?, 'debit', ?, ?, 'transak_offramp', ?, ?, ?)`,
                  [uuidv4(), partnerCustomerId, cryptoAmount, coin, orderId, `Transak OFF-RAMP: sold ${cryptoAmount} ${coin} for ${fiatAmount} ${fiatCurrency}` , now]
                ).catch(() => {});
                console.log(`[Transak] OFF-RAMP: debited ${cryptoAmount} ${coin} from customer=${partnerCustomerId}` );
              } catch (e: any) { console.warn('[Transak] OFF-RAMP debit error:', e.message); }
            }
          } else {
            // ── ON-RAMP (BUY): user bought crypto → credit their crypto + merchant fiat wallets
            if (partnerCustomerId && fiatAmount > 0) {
              try { await walletsSvc.walletsService.topupWallet(partnerCustomerId, fiatAmount, 'transak_order_completed', orderId, fiatCurrency); } catch { /* non-fatal */ }
            }
            if (partnerCustomerId && cryptoAmount > 0) {
              try {
                const cw = await walletsSvc.walletsService.getOrCreateCryptoWallet(partnerCustomerId, coin);
                await db.query('UPDATE customer_crypto_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [cryptoAmount, cw.id]);
              } catch { /* non-fatal */ }
            }
            if (fiatAmount > 0) {
              try {
                const merchantId = 'MRC-1001';
                await db.query(`INSERT INTO omnibus_accounts (account_id, currency, balance, label, created_at, updated_at) VALUES ('VAULT_BANK_OMNIBUS', ?, ?, 'VAULT BANK OMNIBUS', ?, ?) ON CONFLICT(account_id, currency) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at`, [fiatCurrency, fiatAmount, now, now]);
                let mw = (await db.query('SELECT id FROM merchant_wallets WHERE merchant_id = ? AND currency = ? LIMIT 1', [merchantId, fiatCurrency])).rows[0] as any;
                if (!mw) { const mwId = uuidv4(); await db.query('INSERT INTO merchant_wallets (id, merchant_id, balance, currency) VALUES (?, ?, 0, ?)', [mwId, merchantId, fiatCurrency]); mw = { id: mwId }; }
                await db.query('UPDATE merchant_wallets SET balance = balance + ?, updated_at = ? WHERE id = ?', [fiatAmount, now, mw.id]);
                await db.query(`INSERT INTO merchant_wallet_transactions (id, wallet_id, type, amount, currency, source, reference, description, created_at) VALUES (?, ?, 'credit', ?, ?, 'transak_onramp_completed', ?, ?, ?)`, [uuidv4(), mw.id, fiatAmount, fiatCurrency, orderId, `Transak ON-RAMP ORDER_COMPLETED: ${fiatCurrency} ${fiatAmount}` , now]);
                console.log(`[Transak] ON-RAMP: Merchant wallet credited: ${fiatCurrency} ${fiatAmount}` );
              } catch (e: any) { console.warn('[Transak] Merchant credit error:', e.message); }
            }
          }
        }
      } catch (e: any) { console.warn('[Transak] ORDER_COMPLETED error:', e.message); }
    }
    res.status(200).json({ ok: true, verified, eventID, isBuyOrSell, acknowledged: true });
  } catch (e: any) { console.error('[Transak Webhook Error]', e?.message || e); res.status(200).json({ ok: true, error: 'acknowledged' }); }
});

// ── Transak KYC Webhook ───────────────────────────────────────────────────────
app.post('/webhooks/transak/kyc', express.json({ limit: '1mb' }), async (req: Request, res: Response) => {
  try {
    const { db } = await import('./config/db');
    const body = req.body || {};
    let kycData: any = body?.data;
    if (typeof kycData === 'string') {
      try { const jwtLib = await import('jsonwebtoken'); const s = process.env.PARTNER_ACCESS_TOKEN?.trim() || process.env.TRANSAK_API_SECRET?.trim() || ''; kycData = s ? jwtLib.verify(kycData, s) : jwtLib.decode(kycData); } catch { try { kycData = JSON.parse(kycData); } catch { /* use raw */ } }
    }
    kycData = kycData || body;
    const eventID   = String(kycData?.eventID || '').toUpperCase();
    const kycStatus = String(kycData?.kycStatus || '').toUpperCase();
    const userId    = String(kycData?.partnerUserId || kycData?.partnerCustomerId || '');
    console.log(`[Transak KYC] eventID=${eventID} kycStatus=${kycStatus} user=${userId}`);
    if (userId && kycStatus) { await db.query(`UPDATE customers SET kyc_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [kycStatus, userId]).catch(() => {}); }
    return res.status(200).json({ ok: true, acknowledged: true, eventID, kycStatus });
  } catch (e: any) { return res.status(200).json({ ok: true, error: 'acknowledged' }); }
});

if ((process.env.SERVE_FRONTEND === 'true' || process.env.SERVE_FRONTEND === '1') && _frontendDist) {
  app.get(/^\/(?!auth|api|merchant|wallet|webhooks|health).*$/, (_req: Request, res: Response) => {
    return serveInjectedIndexHtml(res);
  });
  app.get("*", (req: Request, res: Response, next: NextFunction) => {
    const p = req.path;
    if (p.startsWith('/auth/') || p.startsWith('/api/') || p.startsWith('/merchant/') ||
        p.startsWith('/wallet/') || p.startsWith('/webhooks/') || p === '/health') {
      return next();
    }
    if (/\.[a-z0-9]{2,6}$/i.test(p)) {
      return next();
    }
    return serveInjectedIndexHtml(res);
  });
}
