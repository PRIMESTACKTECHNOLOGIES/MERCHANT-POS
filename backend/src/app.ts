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
import { merchantsRouter } from "./domain/merchants/merchants.router";
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
import { voiceAuth1011Router } from './domain/payments/voiceAuth1011.router';
import { pos201Router } from './domain/payments/pos201.router';
import processorIdentityRouter from './routes/processorIdentity.router';
import dwollaRouter from './domain/payouts/dwolla.router';
import bankPartnerWebhookRouter from './domain/payouts/bank-partner-webhook.router';

export const app = express();

// â”€â”€ CORS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// ── Frontend (SPA) build resolution ──────────────────────────────────────────
// Gated on SERVE_FRONTEND so API-only deployments don't serve a stale client.
// Candidates cover the Docker image layout (/app/client/dist) as well as the
// alternative copy location and local builds.
const serveFrontend = process.env.SERVE_FRONTEND === "true";
const clientBuildCandidates = [
  path.join(__dirname, "..", "..", "client", "dist"),      // /app/client/dist (Docker)
  path.join(__dirname, "..", "..", "client", "dist-portal"),
  path.join(__dirname, "..", "public"),                    // /app/backend/public
  path.join(__dirname, "public"),
];
const clientBuildPath = clientBuildCandidates.find((p) =>
  fs.existsSync(path.join(p, "index.html")),
);
if (serveFrontend) {
  console.log(
    clientBuildPath
      ? `[frontend] Serving SPA from ${clientBuildPath}`
      : `[frontend] SERVE_FRONTEND=true but no index.html found in: ${clientBuildCandidates.join(", ")}`,
  );
}

// Internal vault-bank gateway: authenticates with its own API key/HMAC contract.
// Mount before the application JWT middleware below.
app.use('/api/vault-bank', express.json({ limit: '1mb' }), vaultGatewayRouter);
app.use('/api/vault', express.json({ limit: '1mb' }), bankPartnerWebhookRouter);
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
app.get("/", (req, res) => {
  // Browsers navigating to the root get the SPA; API clients get the health JSON.
  if (serveFrontend && clientBuildPath && (req.headers.accept || "").includes("text/html")) {
    return res.sendFile(path.join(clientBuildPath, "index.html"));
  }
  res.json({
    status: "ok",
    service: "POS 201.3 Backend",
    timestamp: new Date().toISOString(),
    health_endpoints: ["GET /health", "GET /api/health"],
    auth_endpoints:  ["POST /auth/login"],
  });
});
app.get("/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));
app.get("/api/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// ── POST /api/admin/reset-balances — wipe all fake/test balances ─────────────
app.post("/api/admin/reset-balances", async (_req: Request, res: Response) => {
  try {
    const { db: rDb } = await import("./config/db");
    const tables = [
      "merchant_wallet_transactions","wallet_transactions","pos2013_transactions",
      "card_authorizations","ledger_entries","ledger_transactions",
      "vault_ledger","vault_entries","pos_idempotency","vault_idempotency",
      "authorization_holds","authorization_log","authorization_requests",
      "incoming_payments","transaction_settlements","transaction_approvals",
      "stored_txns","merchant_pos_settlements","card_settlements",
      "batch_settlement","settlement_batches","cashout_transactions","cashouts",
      "offline_txns","offline_funds_receipts","wallet_offline_transactions",
      "wallet_funding_loads","wallet_transfers","merchant_payouts","bank_payouts",
      "mt103_payouts","core_payouts","payout_instructions",
      "reconciliation_reports","reconciliation_discrepancies",
      "settlement_discrepancies","settlement_imports","settlement_reversals",
      "merchant_vault_transfers","transak_orders","transak_orders_v2",
      "vault_payout_requests","vault_payouts","vault_reserve",
      "vault_reconciliation_log","emv_atc","vault_card_loads","vault_real_funds",
    ];
    for (const t of tables) {
      try { await rDb.query(`DELETE FROM ${t}`); } catch { /* table may not exist */ }
    }
    await rDb.query("UPDATE merchant_wallets SET balance=0, updated_at=CURRENT_TIMESTAMP").catch(() => {});
    await rDb.query("UPDATE customer_wallets SET balance=0, updated_at=CURRENT_TIMESTAMP").catch(() => {});
    await rDb.query("UPDATE vault_accounts SET balance=0, reserved_hold=0, updated_at=CURRENT_TIMESTAMP").catch(() => {});
    // Also zero vault_ledger directly via DELETE (in case it wasn't in tables list)
    await rDb.query("DELETE FROM vault_ledger").catch(() => {});
    await rDb.query("DELETE FROM vault_entries").catch(() => {});
    // Force vault_accounts balance to 0 via direct update (bypasses any caching)
    await rDb.query("UPDATE vault_accounts SET balance=0, reserved_hold=0").catch(() => {});
    const mw = await rDb.query("SELECT COUNT(*) c, COALESCE(SUM(balance),0) t FROM merchant_wallets");
    const cw = await rDb.query("SELECT COUNT(*) c, COALESCE(SUM(balance),0) t FROM customer_wallets");
    return res.json({ ok: true, merchantWallets: mw.rows[0], customerWallets: cw.rows[0], message: "All balances and transaction history cleared" });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});
// ── ONE-TIME SETUP: Fix protocol rules + seed operator card auth codes ────────
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

    // Note: ACQUIRER_HOST is intentionally left blank for internal processor mode.
    // Do NOT inject ACQUIRER_HOST here — it forces TCP acquirer and breaks internal approval.

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

// â”€// ── Public webhook endpoint for Transak order + KYC events ──────────────────
// Handles ALL Transak webhook types per docs:
//   Order:  ORDER_CREATED, ORDER_PAYMENT_VERIFYING, ORDER_PROCESSING,
//           ORDER_COMPLETED, ORDER_FAILED, ORDER_REFUNDED, ORDER_EXPIRED
//   KYC:    KYC_SUBMITTED, KYC_APPROVED, KYC_REJECTED
//
// Payload format (current Transak): { data: "<JWT>", eventID: "..." }
// The JWT is decoded without re-verification — outer HMAC already authenticates.
app.post('/webhooks/transak', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  const ACK = { ok: true, acknowledged: true };
  try {
    const transak = await import('./exchange/transak.service');

    // 1. Parse raw body
    const rawBody = (req as any).rawBody || req.body;
    const payloadStr = typeof rawBody === 'string'
      ? rawBody
      : Buffer.isBuffer(rawBody)
        ? rawBody.toString('utf8')
        : JSON.stringify(req.body);

    const bodyJson: any = (() => {
      try { return JSON.parse(payloadStr); } catch { return req.body || {}; }
    })();

    // 2. Verify HMAC signature
    const signature = String(
      req.headers['x-transak-signature'] || req.headers['x-signature'] || ''
    ).trim();
    const webhookSecret = process.env.TRANSAK_WEBHOOK_SECRET?.trim() || '';

    let verified = false;
    if (!webhookSecret) {
      console.warn('[Transak] TRANSAK_WEBHOOK_SECRET not set — skipping signature check');
    } else {
      verified = transak.verifyWebhookSignature(payloadStr, signature, webhookSecret);
      if (!verified) {
        console.warn('[Transak] Webhook signature mismatch — rejecting');
        return res.status(401).json({ ok: false, error: 'Invalid Transak webhook signature' });
      }
    }

    // 3. Decode JWT payload
    const { eventId, webhookData, isKyc } = transak.decodeTransakWebhook(bodyJson);
    console.log(`[Transak Webhook] eventId=${eventId} isKyc=${isKyc} verified=${verified}`);

    // 4. Audit log
    const { db } = await import('./config/db');
    const orderId = webhookData?.id || webhookData?.orderId || bodyJson?.orderId || null;
    const status  = webhookData?.status || 'RECEIVED';
    try {
      await db.query(
        `INSERT OR IGNORE INTO transak_webhook_log
           (event_id, event_name, order_id, status, verified, raw_payload, signature, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [`evt-${Date.now()}`, eventId, orderId, status, verified ? 1 : 0,
         payloadStr.substring(0, 8000), signature.substring(0, 256)]
      );
    } catch { /* non-critical */ }

    // 5. KYC events
    if (isKyc) {
      const kycStatus     = webhookData?.kycStatus || status;
      const partnerUserId = webhookData?.partnerUserId || '';
      const partnerCustId = webhookData?.partnerCustomerId || '';
      console.log(`[Transak KYC] eventId=${eventId} kycStatus=${kycStatus} customer=${partnerCustId || partnerUserId}`);
      const customerId = partnerCustId || partnerUserId;
      if (customerId) {
        const kycDbStatus = eventId === 'KYC_APPROVED' ? 'APPROVED' : eventId === 'KYC_REJECTED' ? 'REJECTED' : 'SUBMITTED';
        await db.query(
          `UPDATE customer_wallets SET kyc_status = ?, updated_at = CURRENT_TIMESTAMP WHERE customer_id = ?`,
          [kycDbStatus, customerId]
        ).catch(() => {});
        await db.query(
          `UPDATE customers SET kyc_status = ?,
            kyc_verified_at = CASE WHEN ? = 'APPROVED' THEN CURRENT_TIMESTAMP ELSE kyc_verified_at END,
            updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [kycDbStatus, kycDbStatus, customerId]
        ).catch(() => {});
        console.log(`[Transak KYC] kyc_status=${kycDbStatus} updated for customer=${customerId}`);
      }
      return res.status(200).json({ ...ACK, eventId, kycStatus });
    }

    // 6. Order events
    const orderStatus    = webhookData?.status || '';
    const partnerCustId  = webhookData?.partnerCustomerId || webhookData?.partnerUserId || '';
    const fiatAmount     = Number(webhookData?.fiatAmount    || 0);
    const cryptoAmount   = Number(webhookData?.cryptoAmount  || 0);
    const fiatCurrency   = String(webhookData?.fiatCurrency  || 'USD').toUpperCase();
    const cryptoCurrency = String(webhookData?.cryptoCurrency || 'USDT').toUpperCase();
    const orderRef       = webhookData?.id || orderId || `transak-${Date.now()}`;
    console.log(`[Transak Order] eventId=${eventId} status=${orderStatus} orderId=${orderRef} customer=${partnerCustId}`);

    switch (eventId) {
      case 'ORDER_CREATED':
      case 'ORDER_PAYMENT_VERIFYING':
      case 'ORDER_PROCESSING':
        // No wallet action yet — wait for COMPLETED
        break;

      case 'ORDER_COMPLETED': {
        if (!partnerCustId) { console.warn('[Transak] ORDER_COMPLETED missing partnerCustomerId'); break; }
        const already = await db.query(
          `SELECT id FROM crypto_transactions WHERE reference IN (?, ?) AND status = 'completed' LIMIT 1`,
          [orderRef, `transak:${orderRef}`]
        );
        if (already.rows?.length) {
          return res.status(200).json({ ...ACK, eventId, duplicate: true });
        }
        const walletsSvc = await import('./domain/wallets/wallets.service');
        const { v4: uuidv4 } = await import('uuid');
        if (fiatAmount > 0) {
          await walletsSvc.walletsService.topupWallet(partnerCustId, fiatAmount, 'transak_onramp', orderRef, fiatCurrency).catch((e: any) => console.error('[Transak] fiat topup failed:', e?.message));
        }
        if (cryptoAmount > 0) {
          const cryptoWallet = await walletsSvc.walletsService.getOrCreateCryptoWallet(partnerCustId, cryptoCurrency);
          await db.query(`UPDATE customer_crypto_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [cryptoAmount, cryptoWallet.id]);
          await db.query(
            `INSERT OR IGNORE INTO crypto_transactions (id, customer_id, crypto_coin, transaction_type, fiat_amount, crypto_amount, fiat_currency, exchange_rate, source, provider_mode, status, reference) VALUES (?, ?, ?, 'buy', ?, ?, ?, ?, 'transak_webhook', 'transak', 'completed', ?)`,
            [uuidv4(), partnerCustId, cryptoCurrency, fiatAmount, cryptoAmount, fiatCurrency, fiatAmount > 0 && cryptoAmount > 0 ? fiatAmount / cryptoAmount : 0, orderRef]
          ).catch(() => {});
          console.log(`[Transak] ORDER_COMPLETED credited: ${cryptoCurrency} ${cryptoAmount} + ${fiatCurrency} ${fiatAmount} → customer=${partnerCustId}`);
        }
        break;
      }

      case 'ORDER_FAILED':
      case 'ORDER_EXPIRED':
        console.log(`[Transak] Order failed/expired: orderId=${orderRef}`);
        break;

      case 'ORDER_REFUNDED':
        if (partnerCustId && fiatAmount > 0) {
          await db.query(`UPDATE customer_wallets SET balance = MAX(0, balance - ?), updated_at = CURRENT_TIMESTAMP WHERE customer_id = ?`, [fiatAmount, partnerCustId]).catch(() => {});
          console.log(`[Transak] Refund debited: ${fiatCurrency} ${fiatAmount} from customer=${partnerCustId}`);
        }
        break;

      default:
        console.log(`[Transak] Unhandled eventId=${eventId}`);
    }

    return res.status(200).json({ ...ACK, eventId, orderStatus });

  } catch (e: any) {
    console.error('[Transak Webhook] Error:', e?.message || e);
    return res.status(200).json({ ok: true, acknowledged: true, error: 'internal_error' });
  }
});

// â•â• ALL ROUTES BELOW REQUIRE AUTHENTICATION â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
// â”€â”€ Coin / crypto logos (public â€” no auth required) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use('/coins', express.static(path.join(__dirname, '..', 'public')));

// 201.3 Processor status — public (no auth needed, no sensitive data)
app.get('/api/pos201/status', (_req: any, res: any) => {
  const isLocal   = process.env.LOCAL_ONLY_MODE?.trim() === 'true';
  const realFunds = process.env.REAL_FUNDS_ONLY?.trim() === 'true';
  res.json({
    protocol: '201.3', status: 'READY',
    mode: isLocal ? 'LOCAL_OFFLINE' : 'ONLINE',
    localOnlyMode: isLocal, realFundsOnly: realFunds,
    cvvRequired: false,
    entryModes: ['MANUAL','KEYED','CNP','MOTO','CHIP','CONTACTLESS','SWIPE'],
    notes: ['CVV NOT required','auth code auto-generated','expiry required for MANUAL entry'],
  });
});

// ── Serve the React SPA (production) ─────────────────────────────────────────
// Must be registered BEFORE authenticateToken: a browser request for the app
// shell or a hashed asset carries no JWT and would otherwise be rejected 401.
if (serveFrontend && clientBuildPath) {
  // Static assets (hashed JS/CSS/fonts/images) — safe to serve unauthenticated.
  app.use(express.static(clientBuildPath));

  // Paths owned by the API — never fall through to the SPA shell, so a direct
  // browser hit still reaches the API (and its auth) instead of the shell.
  const apiPrefixes = [
    "/api", "/auth", "/merchant", "/internal", "/coins", "/payouts", "/wallet",
    "/wallet-cards", "/v2", "/core", "/ledger", "/accounts", "/controlled",
    "/stats", "/provider-funds", "/transfers", "/batch-settlements", "/entries",
    "/credit", "/debit", "/merchant-transfer", "/balance", "/reconciliation",
    "/liquidity", "/real-funds", "/custody-reserve", "/audit", "/security",
    "/reserve", "/beneficiaries", "/sepa", "/card-load", "/card-loads",
  ];
  const isApiPath = (p: string) =>
    apiPrefixes.some((pre) => p === pre || p.startsWith(pre + "/"));

  // SPA history fallback — only for browser navigations (Accept: text/html).
  // JSON/XHR requests pass through to the API routers unchanged.
  app.get("*", (req, res, next) => {
    if (!(req.headers.accept || "").includes("text/html")) return next();
    if (isApiPath(req.path) || req.path.startsWith("/vault-bank/")) return next();
    return res.sendFile(path.join(clientBuildPath, "index.html"));
  });
}

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
app.use('/api/merchants', merchantsRouter);
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
app.use('/api/voice-auth', voiceAuth1011Router);
app.use('/api/pos201', pos201Router);
app.use('/api/processor', processorIdentityRouter);


// ── Vault Bank Acquirer Settlement Callbacks (port 9001 callbacks land here) ─
// vault-bank-acquirer.js calls these after processing auth/reversal/refund.
// These run on the same process/port — the acquirer config points SETTLEMENT_PORT=9001
// but we serve these from port 7000 on /api/vault/internal/*
app.post('/api/vault/internal/add-pending-auth', async (req: Request, res: Response) => {
  try {
    const { db: sDb } = await import('./config/db');
    const { v4: sUuid } = await import('uuid');
    const body = req.body || {};
    const now = new Date().toISOString();
    const entryId = sUuid();
    const amount = Number(body.amount || 0) / 100; // acquirer sends minor units
    const ccy = String(body.currencyCode || 'USD').toUpperCase();
    const mid = String(body.mid || 'MRC-1001');

    // Credit vault entries ledger
    const accountId = ccy === 'EUR' ? 'PROC-VAULT-EUR-001' : 'PROC-VAULT-USD-002';
    await sDb.query(
      `INSERT INTO vault_entries (id, group_id, account_id, direction, amount, currency, reference, source, status, metadata, created_at)
       VALUES (?, ?, ?, 'credit', ?, ?, ?, 'vault_bank_acquirer', 'POSTED', '{}', ?)`,
      [entryId, 'VB-GRP-' + entryId.slice(0, 8), accountId, amount, ccy, body.stan || entryId, now]
    );

    // Credit merchant wallet
    const { walletsService: ws } = await import('./domain/wallets/wallets.service');
    await ws.creditMerchantWallet(mid, amount, 'card_capture', body.stan || entryId, ccy);

    console.log('[Settlement] Pending auth credited — ' + ccy + ' ' + amount + ' to ' + mid);
    return res.json({ ok: true, entryId, amount, currency: ccy });
  } catch (e: any) {
    console.error('[Settlement] add-pending-auth error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/vault/internal/reverse-transaction', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const { db: sDb } = await import('./config/db');
    const { v4: sUuid } = await import('uuid');
    const now = new Date().toISOString();
    const amount = Number(body.amount || 0) / 100;
    const ccy = String(body.currencyCode || 'USD').toUpperCase();
    const mid = String(body.mid || 'MRC-1001');
    const accountId = ccy === 'EUR' ? 'PROC-VAULT-EUR-001' : 'PROC-VAULT-USD-002';
    const entryId = sUuid();

    // Debit vault (reversal)
    await sDb.query(
      `INSERT INTO vault_entries (id, group_id, account_id, direction, amount, currency, reference, source, status, metadata, created_at)
       VALUES (?, ?, ?, 'debit', ?, ?, ?, 'reversal', 'POSTED', '{}', ?)`,
      [entryId, 'VB-GRP-' + entryId.slice(0, 8), accountId, amount, ccy, body.stan || entryId, now]
    );
    // Debit merchant wallet
    const { walletsService: ws2 } = await import('./domain/wallets/wallets.service');
    try { await ws2.debitWallet(mid, amount, 'reversal', body.stan || entryId, ccy); } catch { /* ok if already 0 */ }

    return res.json({ ok: true, responseCode: '00' });
  } catch (e: any) {
    return res.status(500).json({ ok: false, responseCode: '96', error: e.message });
  }
});

app.post('/api/vault/internal/refund-transaction', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const { db: sDb } = await import('./config/db');
    const { v4: sUuid } = await import('uuid');
    const now = new Date().toISOString();
    const amount = Number(body.amount || 0) / 100;
    const ccy = String(body.currencyCode || 'USD').toUpperCase();
    const mid = String(body.mid || 'MRC-1001');
    const accountId = ccy === 'EUR' ? 'PROC-VAULT-EUR-001' : 'PROC-VAULT-USD-002';
    const entryId = sUuid();

    await sDb.query(
      `INSERT INTO vault_entries (id, group_id, account_id, direction, amount, currency, reference, source, status, metadata, created_at)
       VALUES (?, ?, ?, 'debit', ?, ?, ?, 'refund', 'POSTED', '{}', ?)`,
      [entryId, 'VB-GRP-' + entryId.slice(0, 8), accountId, amount, ccy, body.stan || entryId, now]
    );

    return res.json({ ok: true, responseCode: '00' });
  } catch (e: any) {
    return res.status(500).json({ ok: false, responseCode: '96', error: e.message });
  }
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

// ── Unmatched request fallback (non-navigation GETs / API 404s) ──────────────
// Browser navigations are already handled by the pre-auth SPA fallback above.
app.get("*", (_req, res) => {
  res.status(200).json({ status: "ok", message: "POS 201.3 API running" });
});

// â”€â”€ Global error handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Error]", err.message || err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Internal server error" });
});