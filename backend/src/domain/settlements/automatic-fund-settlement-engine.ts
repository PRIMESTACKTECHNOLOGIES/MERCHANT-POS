import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../config/db";
import { walletsService } from "../wallets/wallets.service";

export type AFSEConfigStatus =
  | "READY"
  | "NEEDS_LOOKUP_URL"
  | "NEEDS_CAPTURE_URL"
  | "NEEDS_BOTH";

export type AFSERunStatus =
  | "PENDING"
  | "LOOKUP_STARTED"
  | "LOOKUP_FOUND"
  | "LOOKUP_NOT_FOUND"
  | "LOOKUP_FAILED"
  | "CAPTURE_STARTED"
  | "CAPTURE_SUCCESS"
  | "CAPTURE_FAILED"
  | "CUSTOMER_CREDITED"
  | "CREDIT_FAILED"
  | "COMPLETE"
  | "ALREADY_SETTLED"
  | "CONFIG_ERROR"
  | "MISSING_CUSTOMER_MAPPING";

export interface AFSEAuthState {
  auth_code: string;
  pos_txn_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  wallet_id: string | null;
  wallet_code: string | null;
  amount: number;
  currency: string;
  card_brand: string | null;
  scheme: string;
  auth_status_in_db: string;
  settled_at: string | null;
  lookup_result: any | null;
  capture_result: any | null;
  settlement_id: string | null;
  run_status: AFSERunStatus;
  error_message?: string | null;
  last_step_at?: string | null;
  dry_run?: boolean;
  would_post?: {
    lookup: {
      url: string;
      payload: any;
      headers_redacted: Record<string, string>;
    };
    capture: {
      url: string;
      payload: any;
      headers_redacted: Record<string, string>;
    } | null;
  } | null;
  skip_reason?: string | null;
}

export interface AFSEStatusSummary {
  config: {
    status: AFSEConfigStatus;
    lookupUrlConfigured: boolean;
    captureUrlConfigured: boolean;
    lookupUrlPreview: string | null;
    dry_run_enabled: boolean;
    processor_merchant_id: string | null;
  };
  pipeline: {
    totalEligible: number;
    lookupPending: number;
    capturePending: number;
    creditPending: number;
    alreadyCredited: number;
    failed: number;
    missingCustomer: number;
  };
  eligibleAuths: Array<{
    auth_code: string;
    customer_id: string | null;
    customer_name: string | null;
    wallet_code: string | null;
    amount: number;
    currency: string;
    card_brand: string | null;
    scheme: string;
    status: string;
  }>;
  lastRuns: Array<any>;
}

interface ResolvedCustomer {
  customer_id: string;
  customer_name: string | null;
  wallet_id: string;
  wallet_code: string | null;
}

export class AutomaticFundSettlementEngine {
  private LOOKUP_URL = process.env.CARD_PROCESSOR_LOOKUP_URL || "";
  private CAPTURE_URL = process.env.CARD_PROCESSOR_CAPTURE_URL || "";
  private AUTH_HEADER = process.env.CARD_PROCESSOR_AUTH_HEADER || "";
  private TIMEOUT_MS = Number(process.env.CARD_PROCESSOR_TIMEOUT_MS || 15000);
  private MERCHANT_ID_OVERRIDE = process.env.CARD_PROCESSOR_MERCHANT_ID || "";
  private ENABLED = false;

  constructor() {
    this.refreshEnv();
  }

  refreshEnv() {
    this.LOOKUP_URL = process.env.CARD_PROCESSOR_LOOKUP_URL || "";
    this.CAPTURE_URL = process.env.CARD_PROCESSOR_CAPTURE_URL || "";
    this.AUTH_HEADER = process.env.CARD_PROCESSOR_AUTH_HEADER || "";
    this.TIMEOUT_MS = Number(process.env.CARD_PROCESSOR_TIMEOUT_MS || 15000);
    this.MERCHANT_ID_OVERRIDE = process.env.CARD_PROCESSOR_MERCHANT_ID || "";
    const enabledRaw = String(process.env.CARD_PROCESSOR_ENABLED || "false").trim().toLowerCase();
    this.ENABLED =
      enabledRaw === "1" || enabledRaw === "true" || enabledRaw === "on" || enabledRaw === "yes";
  }

  isEnabledLive(): boolean {
    if (this.isTransactPayEnabled()) {
      return String(process.env.TRANSACTPAY_SECRET_KEY || '').trim().length > 0 &&
        this.isUsableProcessorUrl(this.transactPayBaseUrl());
    }
    return this.ENABLED && this.isUsableProcessorUrl(this.LOOKUP_URL) && this.isUsableProcessorUrl(this.CAPTURE_URL);
  }

  private isTransactPayEnabled(): boolean {
    const enabled = String(process.env.TRANSACTPAY_CAPTURE_ENABLED || '').trim().toLowerCase();
    return ['1', 'true', 'on', 'yes'].includes(enabled);
  }

  private transactPayBaseUrl(): string {
    return String(process.env.TRANSACTPAY_BASE_URL || 'https://payment-api-service.transactpay.ai')
      .trim().replace(/\/+$/, '');
  }

  private transactPayHeaders(): Record<string, string> {
    const secret = String(process.env.TRANSACTPAY_SECRET_KEY || '').trim();
    return { 'Content-Type': 'application/json', Accept: 'application/json', 'api-key': secret };
  }

  private redactedTransactPayHeaders(): Record<string, string> {
    const secret = String(process.env.TRANSACTPAY_SECRET_KEY || '').trim();
    return { 'Content-Type': 'application/json', Accept: 'application/json', 'api-key': secret ? `${secret.slice(0, 6)}***${secret.slice(-4)}` : '[missing]' };
  }

  getMerchantIdOverride(): string | null {
    return this.MERCHANT_ID_OVERRIDE ? String(this.MERCHANT_ID_OVERRIDE) : null;
  }

  private resolvedMerchantId(posTxnMerchantId: string | null | undefined): string | null {
    if (this.MERCHANT_ID_OVERRIDE) return String(this.MERCHANT_ID_OVERRIDE);
    return posTxnMerchantId ? String(posTxnMerchantId) : null;
  }

  private isUsableProcessorUrl(value: string): boolean {
    const url = String(value || '').trim();
    if (!/^https:\/\//i.test(url)) return false;
    return !/(your[-_.]?processor|example\.com|localhost|127\.0\.0\.1)/i.test(url);
  }

  private headersForProcessor(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.AUTH_HEADER) {
      headers["Authorization"] = this.AUTH_HEADER;
    }
    return headers;
  }

  private headersForProcessorRedacted(): Record<string, string> {
    const headers = this.headersForProcessor();
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === "authorization" && v) {
        const parts = v.split(/\s+/, 2);
        const token = parts.length === 2 ? parts[1] : v;
        const masked =
          token.length <= 8
            ? token.slice(0, 2) + "***" + token.slice(-2)
            : token.slice(0, 5) + "***" + token.slice(-4);
        out[k] = (parts.length === 2 ? parts[0] + " " : "") + masked;
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  private inferSchemeFromBrandOrPan(brand: string | null, panMasked: string | null):
    | "visa"
    | "mastercard"
    | "unionpay"
    | "amex"
    | "unknown" {
    try {
      const brandLower = String(brand || "").toLowerCase().trim();
      if (brandLower.includes("visa")) return "visa";
      if (brandLower.includes("master") || brandLower.includes("mc") || brandLower === "mastercard") return "mastercard";
      if (brandLower.includes("amex") || brandLower.includes("american") || brandLower === "american express") return "amex";
      if (brandLower.includes("union") || brandLower === "unionpay" || brandLower.includes("cup")) return "unionpay";
      const pan = String(panMasked || "").replace(/\s+/g, "");
      const first1 = pan.charAt(0);
      const first2 = pan.slice(0, 2);
      const first4 = Number(pan.slice(0, 4));
      if (first1 === "4") return "visa";
      if (["51", "52", "53", "54", "55"].includes(first2)) return "mastercard";
      if (first4 >= 2221 && first4 <= 2720) return "mastercard";
      if (first2 === "34" || first2 === "37") return "amex";
      if (first1 === "6" || first1 === "9" || pan.startsWith("62")) return "unionpay";
      return "unknown";
    } catch {
      return "unknown";
    }
  }

  private async resolveCustomerForPosTxn(txn: {
    id: string;
    amount_minor: number;
    currency: string;
    auth_code: string;
  }): Promise<ResolvedCustomer | null> {
    // Primary: authorization_requests.customer_id (standard path)
    const byAuth = await db.query(
      `SELECT c.id as customer_id, c.name as customer_name,
              w.id as wallet_id, w.wallet_code
       FROM authorization_requests ar
       JOIN customers c ON c.id = ar.customer_id
       LEFT JOIN customer_wallets w ON w.customer_id = c.id AND w.currency = ?
       WHERE ar.transaction_id = ?
       LIMIT 1`,
      [txn.currency, txn.id]
    );
    if (byAuth.rows?.[0]) {
      const r = byAuth.rows[0] as any;
      return {
        customer_id: r.customer_id,
        customer_name: r.customer_name,
        wallet_id: r.wallet_id,
        wallet_code: r.wallet_code,
      };
    }
    // Secondary: wallet_transactions.source='pos_settlement' reference match
    const exactAmount = Number(txn.amount_minor) / 100;
    const byLedger = await db.query(
      `SELECT DISTINCT w.customer_id, c.name as customer_name,
              w.id as wallet_id, w.wallet_code,
              ABS(CAST(w.balance AS REAL) - ?) as bal_diff
       FROM wallet_transactions wt
       JOIN customer_wallets w ON w.id = wt.wallet_id AND w.currency = ?
       JOIN customers c ON c.id = w.customer_id
       WHERE wt.source IN ('pos_settlement','settlement','card_settlement')
         AND (wt.description LIKE ? OR wt.reference LIKE ? OR wt.amount = ?)
       ORDER BY bal_diff ASC
       LIMIT 1`,
      [
        exactAmount,
        txn.currency,
        `%${txn.auth_code}%`,
        `%${txn.auth_code}%`,
        exactAmount,
      ]
    );
    if (byLedger.rows?.[0]) {
      const r = byLedger.rows[0] as any;
      return {
        customer_id: r.customer_id,
        customer_name: r.customer_name,
        wallet_id: r.wallet_id,
        wallet_code: r.wallet_code,
      };
    }
    // Tertiary: 1:1 unique balance match (customer wallet balance == txn amount, same currency)
    const byBalance = await db.query(
      `SELECT w.customer_id, c.name as customer_name, w.id as wallet_id, w.wallet_code,
              (SELECT COUNT(*) FROM customer_wallets w2
                WHERE CAST(w2.balance AS REAL) = ? AND w2.currency = ?) as same_balance_count
       FROM customer_wallets w
       JOIN customers c ON c.id = w.customer_id
       WHERE CAST(w.balance AS REAL) = ? AND w.currency = ?
       ORDER BY c.name ASC
       LIMIT 2`,
      [exactAmount, txn.currency, exactAmount, txn.currency]
    );
    if (byBalance.rows?.length === 1) {
      const r = byBalance.rows[0] as any;
      if (Number(r.same_balance_count || 0) === 1) {
        return {
          customer_id: r.customer_id,
          customer_name: r.customer_name,
          wallet_id: r.wallet_id,
          wallet_code: r.wallet_code,
        };
      }
    }
    return null;
  }

  async getConfigStatus(): Promise<AFSEConfigStatus> {
    this.refreshEnv();
    const L = this.isUsableProcessorUrl(this.LOOKUP_URL);
    const C = this.isUsableProcessorUrl(this.CAPTURE_URL);
    if (L && C) return "READY";
    if (L && !C) return "NEEDS_CAPTURE_URL";
    if (!L && C) return "NEEDS_LOOKUP_URL";
    return "NEEDS_BOTH";
  }

  private async findEligiblePosTxns(): Promise<Array<{ txn: any; resolved: ResolvedCustomer | null }>> {
    const allTxns = await db.query(`
      SELECT * FROM pos2013_transactions t
      WHERE (
        UPPER(COALESCE(t.status,'')) IN ('SETTLED','AUTHORIZED','SYNCED','COMPLETED','APPROVED','AUTHORISED')
      )
      AND CAST(t.amount_minor AS INTEGER) > 0
      AND t.auth_code IS NOT NULL AND TRIM(t.auth_code) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM transaction_settlements ts
        WHERE ts.transaction_id = t.id
        AND ts.status = 'REAL_SCHEME_CREDITED_TO_MERCHANT'
      )
      ORDER BY t.created_at ASC
    `);
    const list: Array<{ txn: any; resolved: ResolvedCustomer | null }> = [];
    for (const t of (allTxns.rows || []) as any[]) {
      const resolved = await this.resolveCustomerForPosTxn({
        id: t.id,
        amount_minor: Number(t.amount_minor),
        currency: String(t.currency || "USD"),
        auth_code: String(t.auth_code),
      });
      list.push({ txn: t, resolved });
    }
    return list;
  }

  async getStatus(): Promise<AFSEStatusSummary> {
    this.refreshEnv();
    const rows = await this.findEligiblePosTxns();
    let lookupPending = 0;
    let capturePending = 0;
    let creditPending = 0;
    let failed = 0;
    let missingCustomer = 0;
    for (const { txn, resolved } of rows) {
      const tsRow = await db.query(
        `SELECT status, hold_reason FROM transaction_settlements WHERE transaction_id = ? ORDER BY created_at DESC LIMIT 1`,
        [txn.id]
      );
      if (!resolved) missingCustomer++;
      const st = String((tsRow.rows?.[0] as any)?.status || "");
      if (st === "REAL_CAPTURE_FAILED" || st === "REAL_LOOKUP_FAILED" || st === "REAL_MERCHANT_CREDIT_FAILED") failed++;
      else if (st === "REAL_CAPTURE_SUCCESS") creditPending++;
      else if (st === "REAL_LOOKUP_SUCCESS") capturePending++;
      else lookupPending++;
    }
    const alreadyCreditedRes = await db.query(
      `SELECT COUNT(*) as cnt FROM transaction_settlements WHERE status = 'REAL_SCHEME_CREDITED_TO_MERCHANT'`
    );
    const alreadyCredited = Number((alreadyCreditedRes.rows?.[0] as any)?.cnt || 0);
    const lastRunsRes = await db.query(
      `SELECT ts.*, t.auth_code, t.amount_minor, t.currency, t.card_brand,
              c.id as customer_id, c.name as customer_name, w.wallet_code
       FROM transaction_settlements ts
       LEFT JOIN pos2013_transactions t ON t.id = ts.transaction_id
       LEFT JOIN customers c ON c.id = (
         SELECT ar.customer_id FROM authorization_requests ar WHERE ar.transaction_id = t.id LIMIT 1
       )
       LEFT JOIN customer_wallets w ON w.customer_id = c.id AND w.currency = t.currency
       WHERE ts.status IN (
         'REAL_LOOKUP_STARTED','REAL_LOOKUP_SUCCESS','REAL_LOOKUP_FAILED',
         'REAL_CAPTURE_STARTED','REAL_CAPTURE_SUCCESS','REAL_CAPTURE_FAILED',
         'REAL_SCHEME_CREDITED_TO_MERCHANT','REAL_MERCHANT_CREDIT_FAILED',
         'MISSING_CUSTOMER_MAPPING','CONFIG_ERROR_PENDING_PROCESSOR_URLS'
       )
       ORDER BY ts.updated_at DESC LIMIT 15`
    );
    const lookupUrlPreview = this.LOOKUP_URL
      ? this.LOOKUP_URL.replace(/^(.{8}).*(.{12})$/, "$1***$2")
      : null;
    return {
      config: {
        status: await this.getConfigStatus(),
        lookupUrlConfigured: !!this.LOOKUP_URL,
        captureUrlConfigured: !!this.CAPTURE_URL,
        lookupUrlPreview,
        dry_run_enabled: !this.isEnabledLive(),
        processor_merchant_id: this.getMerchantIdOverride(),
      },
      pipeline: {
        totalEligible: rows.length,
        lookupPending,
        capturePending,
        creditPending,
        alreadyCredited,
        failed,
        missingCustomer,
      },
      eligibleAuths: rows.map(({ txn, resolved }) => ({
        auth_code: String(txn.auth_code),
        customer_id: resolved?.customer_id || null,
        customer_name: resolved?.customer_name || null,
        wallet_code: resolved?.wallet_code || null,
        amount: Number(txn.amount_minor) / 100,
        currency: String(txn.currency || "USD"),
        card_brand: txn.card_brand || null,
        scheme: this.inferSchemeFromBrandOrPan(txn.card_brand || null, txn.pan_masked || null),
        status: String(txn.status || ""),
      })),
      lastRuns: (lastRunsRes.rows || []) as any[],
    };
  }

  private async upsertSettlementRow(
    params: {
      transaction_id: string;
      merchant_id?: string | null;
      status: string;
      hold_reason?: string | null;
      gross_amount?: number | null;
      fee_amount?: number | null;
      net_amount?: number | null;
      currency?: string | null;
      settled_at?: string | null;
      reversed_at?: string | null;
      adjusted_at?: string | null;
      meta?: any;
      reconciliation_id?: string | null;
    }
  ): Promise<string> {
    const existing = await db.query(
      `SELECT id FROM transaction_settlements WHERE transaction_id = ? ORDER BY created_at DESC LIMIT 1`,
      [params.transaction_id]
    );
    let id: string;
    const gross = params.gross_amount ?? 0;
    const fee = params.fee_amount ?? 0;
    const net = params.net_amount ?? (gross - fee);
    const currency = params.currency || "USD";
    const metaJson = params.meta ? JSON.stringify(params.meta) : null;
    if (existing.rows?.[0]) {
      id = (existing.rows[0] as any).id;
      await db.query(
        `UPDATE transaction_settlements SET
           status = ?,
           hold_reason = COALESCE(?, hold_reason),
           gross_amount = COALESCE(?, gross_amount),
           fee_amount = COALESCE(?, fee_amount),
           net_amount = COALESCE(?, net_amount),
           currency = COALESCE(?, currency),
           settled_at = COALESCE(?, settled_at),
           reversed_at = COALESCE(?, reversed_at),
           adjusted_at = COALESCE(?, adjusted_at),
           reconciliation_id = COALESCE(?, reconciliation_id),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          params.status,
          params.hold_reason ?? null,
          gross,
          fee,
          net,
          currency,
          params.settled_at ?? null,
          params.reversed_at ?? null,
          params.adjusted_at ?? null,
          params.reconciliation_id ?? null,
          id,
        ]
      );
      if (metaJson) {
        try {
          await db.query(
            `ALTER TABLE transaction_settlements ADD COLUMN meta_json TEXT`
          );
        } catch (_) {}
        try {
          await db.query(
            `UPDATE transaction_settlements SET meta_json = ? WHERE id = ?`,
            [metaJson, id]
          );
        } catch (_) {}
      }
    } else {
      id = uuidv4();
      await db.query(
        `INSERT INTO transaction_settlements (
          id, merchant_id, transaction_id, reconciliation_id,
          gross_amount, fee_amount, net_amount, currency,
          status, hold_reason, settled_at, reversed_at, adjusted_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          id,
          params.merchant_id || null,
          params.transaction_id,
          params.reconciliation_id || null,
          gross,
          fee,
          net,
          currency,
          params.status,
          params.hold_reason || null,
          params.settled_at || null,
          params.reversed_at || null,
          params.adjusted_at || null,
        ]
      );
      if (metaJson) {
        try {
          await db.query(
            `ALTER TABLE transaction_settlements ADD COLUMN meta_json TEXT`
          );
        } catch (_) {}
        try {
          await db.query(
            `UPDATE transaction_settlements SET meta_json = ? WHERE id = ?`,
            [metaJson, id]
          );
        } catch (_) {}
      }
    }
    return id;
  }

  async runForAuthCode(
    code: string,
    initiatedBy: string = "system"
  ): Promise<AFSEAuthState> {
    this.refreshEnv();
    const codeClean = String(code || "").trim();
    if (!codeClean) {
      return this.emptyState("CONFIG_ERROR", "auth code required");
    }
    const txnRes = await db.query(
      `SELECT * FROM pos2013_transactions WHERE auth_code = ? ORDER BY created_at DESC LIMIT 1`,
      [codeClean]
    );
    if (!txnRes.rows?.[0]) {
      return this.emptyState("CONFIG_ERROR", `auth code ${codeClean} not found in pos2013_transactions`, codeClean);
    }
    const txn = txnRes.rows[0] as any;
    const resolved = await this.resolveCustomerForPosTxn({
      id: txn.id,
      amount_minor: Number(txn.amount_minor),
      currency: String(txn.currency || "USD"),
      auth_code: String(txn.auth_code),
    });
    const amount = Number(txn.amount_minor) / 100;
    const currency = String(txn.currency || "USD").toUpperCase();
    const scheme = this.inferSchemeFromBrandOrPan(txn.card_brand || null, txn.pan_masked || null);
    const merchantId = this.resolvedMerchantId(txn.merchant_id);
    const transactPay = this.isTransactPayEnabled();
    const isDryRun = transactPay ? false : !this.isEnabledLive();
    const base: AFSEAuthState = {
      auth_code: codeClean,
      pos_txn_id: txn.id,
      customer_id: resolved?.customer_id || null,
      customer_name: resolved?.customer_name || null,
      wallet_id: resolved?.wallet_id || null,
      wallet_code: resolved?.wallet_code || null,
      amount,
      currency,
      card_brand: txn.card_brand || null,
      scheme,
      auth_status_in_db: String(txn.status || ""),
      settled_at: txn.txn_timestamp || txn.created_at || null,
      lookup_result: null,
      capture_result: null,
      settlement_id: null,
      run_status: "PENDING",
      dry_run: isDryRun,
      would_post: null,
      skip_reason: isDryRun ? "CARD_PROCESSOR_ENABLED=false — engine runs in safe DRY-RUN mode (no real axios calls, no wallet credits). Flip to true after payloads verified." : null,
    };
    const already = await db.query(
      `SELECT id FROM transaction_settlements WHERE transaction_id = ? AND status = 'REAL_SCHEME_CREDITED_TO_MERCHANT' LIMIT 1`,
      [txn.id]
    );
    if (already.rows?.[0]) {
      base.run_status = "ALREADY_SETTLED";
      base.settlement_id = (already.rows[0] as any).id;
      return base;
    }
    const cfg = await this.getConfigStatus();
    const transactPaySecret = String(process.env.TRANSACTPAY_SECRET_KEY || '').trim();
    const transactPayReady = transactPay && transactPaySecret.length > 0 && this.isUsableProcessorUrl(this.transactPayBaseUrl());
    if ((transactPay && !transactPayReady) || (!transactPay && cfg !== "READY")) {
      await this.upsertSettlementRow({
        transaction_id: txn.id,
        merchant_id: txn.merchant_id || null,
        status: "CONFIG_ERROR_PENDING_PROCESSOR_URLS",
        hold_reason: transactPay ? "TRANSACTPAY_SECRET_KEY or TRANSACTPAY_BASE_URL is missing/invalid" : cfg,
        gross_amount: amount,
        fee_amount: 0,
        net_amount: amount,
        currency,
        meta: {
          scheme,
          step: "config_check",
          cfg: transactPay ? "TRANSACTPAY_NOT_READY" : cfg,
          provider: transactPay ? "transactpay" : "card_processor",
          initiated_by: initiatedBy,
          required_env_vars: transactPay
            ? ["TRANSACTPAY_SECRET_KEY", "TRANSACTPAY_BASE_URL"]
            :
            cfg === "NEEDS_BOTH"
              ? ["CARD_PROCESSOR_LOOKUP_URL", "CARD_PROCESSOR_CAPTURE_URL"]
              : cfg === "NEEDS_LOOKUP_URL"
                ? ["CARD_PROCESSOR_LOOKUP_URL"]
                : ["CARD_PROCESSOR_CAPTURE_URL"],
        },
      });
      base.run_status = "CONFIG_ERROR";
      const needed = transactPay
        ? "TRANSACTPAY_SECRET_KEY + valid HTTPS TRANSACTPAY_BASE_URL"
        :
        cfg === "NEEDS_BOTH"
          ? "CARD_PROCESSOR_LOOKUP_URL + CARD_PROCESSOR_CAPTURE_URL"
          : cfg === "NEEDS_LOOKUP_URL"
            ? "CARD_PROCESSOR_LOOKUP_URL"
            : "CARD_PROCESSOR_CAPTURE_URL";
      base.error_message =
        `Processor not wired (${cfg}). Set env vars in backend/.env: ${needed}. ` +
        `See .env lines CARD_PROCESSOR_* block for full JSON body contract the engine will POST to those URLs.`;
      return base;
    }
    // ─── Step 1: Clearing lookup (or TransactPay order reference) ────────
    base.run_status = "LOOKUP_STARTED";
    await this.upsertSettlementRow({
      transaction_id: txn.id,
      merchant_id: merchantId || txn.merchant_id || null,
      status: isDryRun ? "DRY_LOOKUP_STARTED" : "REAL_LOOKUP_STARTED",
      hold_reason: transactPay
        ? "TransactPay capture uses the existing TransactPay order reference; no clearing lookup is required"
        : `${isDryRun ? "DRY-RUN: " : ""}POST scheme=${scheme} to CARD_PROCESSOR_LOOKUP_URL`,
      gross_amount: amount,
      fee_amount: 0,
      net_amount: amount,
      currency,
      meta: { scheme, initiated_by: initiatedBy, step: isDryRun ? "dry_lookup_started" : "lookup_started" },
    });
    const lookupPayload = {
      authorization_reference: codeClean,
      pos_transaction_id: txn.id,
      local_txn_id: txn.local_txn_id,
      batch_id: txn.batch_id,
      terminal_id: txn.terminal_id,
      merchant_id: merchantId,
      stan: txn.stan || null,
      rrn: txn.rrn || null,
      amount,
      amount_minor: Number(txn.amount_minor),
      currency,
      customer_id: resolved?.customer_id || null,
      card_brand: txn.card_brand || null,
      pan_masked: txn.pan_masked || null,
      scheme,
      txn_timestamp: txn.txn_timestamp || null,
      created_at: txn.created_at || null,
      expected_settled_customer_name: resolved?.customer_name || null,
    };
    const wouldPostCapture: {
      url: string;
      payload: any;
      headers_redacted: Record<string, string>;
    } = {
      url: this.CAPTURE_URL,
      payload: null,
      headers_redacted: this.headersForProcessorRedacted(),
    };
    base.would_post = {
      lookup: {
        url: transactPay ? `${this.transactPayBaseUrl()}/payment/order/verify` : this.LOOKUP_URL,
        payload: transactPay ? { reference: codeClean } : lookupPayload,
        headers_redacted: transactPay ? this.redactedTransactPayHeaders() : this.headersForProcessorRedacted(),
      },
      capture: wouldPostCapture,
    };
    let lookupResult: any = null;
    try {
      if (transactPay) {
        lookupResult = {
          success: true,
          provider: 'transactpay',
          reference: codeClean,
          note: 'TransactPay path skips scheme clearing lookup and verifies the order reference before/after capture.',
        };
      } else if (isDryRun) {
        lookupResult = {
          success: true,
          dry_run: true,
          lookup_id: `DRY-LOOKUP-${codeClean}`,
          funds_location: `DRY_${scheme.toUpperCase()}_CLEARING_SUSPENSE_${currency}_MOCK_0001`,
          funds_held_at: "suspense_clearing_member_mock",
          can_pull: true,
          note: "This is a DRY-RUN lookup response (CARD_PROCESSOR_ENABLED=false). No actual POST was made. When ENABLED=true the engine POSTs payload above to the lookup URL with redacted Authorization header.",
        };
      } else {
        const r = await axios.post(this.LOOKUP_URL, lookupPayload, {
          headers: this.headersForProcessor(),
          timeout: this.TIMEOUT_MS,
        });
        lookupResult = r.data || { ok: true };
      }
      base.lookup_result = lookupResult;
      base.run_status = "LOOKUP_FOUND";
      await this.upsertSettlementRow({
        transaction_id: txn.id,
        status: isDryRun ? "DRY_LOOKUP_SUCCESS" : "REAL_LOOKUP_SUCCESS",
        hold_reason:
          lookupResult?.funds_location ||
          lookupResult?.funds_held_at ||
          lookupResult?.location ||
          lookupResult?.message ||
          "lookup_ok",
        meta: {
          scheme,
          lookupResult,
          lookupPayload,
          initiated_by: initiatedBy,
          step: isDryRun ? "dry_lookup_success" : "lookup_success",
        },
      });
    } catch (lookupErr: any) {
      base.run_status = "LOOKUP_FAILED";
      base.error_message =
        lookupErr?.response?.data?.message ||
        lookupErr?.message ||
        "scheme clearing lookup failed";
      await this.upsertSettlementRow({
        transaction_id: txn.id,
        status: isDryRun ? "DRY_LOOKUP_FAILED" : "REAL_LOOKUP_FAILED",
        hold_reason: String(base.error_message).slice(0, 250),
        meta: {
          scheme,
          error: base.error_message,
          response_body: lookupErr?.response?.data || null,
          initiated_by: initiatedBy,
          step: isDryRun ? "dry_lookup_failed" : "lookup_failed",
        },
      });
      return base;
    }
    // ─── Step 2: Pull real funds (capture) ───────────────────────────────
    base.run_status = "CAPTURE_STARTED";
    const pullLocation =
      lookupResult?.funds_location ||
      lookupResult?.funds_held_at ||
      lookupResult?.location ||
      "suspense";
    await this.upsertSettlementRow({
      transaction_id: txn.id,
      status: isDryRun ? "DRY_CAPTURE_STARTED" : "REAL_CAPTURE_STARTED",
      hold_reason: transactPay
        ? "POST TransactPay preauthorization capture, then verify order status"
        : `${isDryRun ? "DRY-RUN: " : ""}POST scheme=${scheme} to CARD_PROCESSOR_CAPTURE_URL pull_from=${pullLocation}`,
      meta: { scheme, lookupResult, initiated_by: initiatedBy, step: isDryRun ? "dry_capture_started" : "capture_started" },
    });
    const capturePayload = transactPay
      ? { reference: codeClean, Amount: amount }
      : {
      authorization_reference: codeClean,
      lookup_ref:
        lookupResult?.lookup_id ||
        lookupResult?.id ||
        lookupResult?.ref ||
        (isDryRun ? lookupResult?.lookup_id : null),
      funds_location: pullLocation,
      pos_transaction_id: txn.id,
      amount,
      amount_minor: Number(txn.amount_minor),
      currency,
      scheme,
      card_brand: txn.card_brand || null,
      pan_masked: txn.pan_masked || null,
      merchant_id: merchantId,
      terminal_id: txn.terminal_id || null,
      batch_id: txn.batch_id || null,
      stan: txn.stan || null,
      rrn: txn.rrn || null,
      txn_timestamp: txn.txn_timestamp || null,
      credit_target: {
        party: "merchant",
        merchant_id: merchantId,
        customer_id: resolved?.customer_id || null,
        customer_name: resolved?.customer_name || null,
        wallet_id: resolved?.wallet_id || null,
        wallet_code: resolved?.wallet_code || null,
        wallet_currency: currency,
      },
    };
    if (base.would_post) base.would_post.capture = {
      url: transactPay ? `${this.transactPayBaseUrl()}/payment/order/pay/capture` : this.CAPTURE_URL,
      payload: capturePayload,
      headers_redacted: transactPay ? this.redactedTransactPayHeaders() : this.headersForProcessorRedacted(),
    };
    let captureResult: any = null;
    try {
      if (transactPay) {
        const captureResponse = await axios.post(`${this.transactPayBaseUrl()}/payment/order/pay/capture`, capturePayload, {
          headers: this.transactPayHeaders(),
          timeout: this.TIMEOUT_MS,
        });
        const captureBody = captureResponse.data || {};
        if (captureBody.status === false || captureBody.statusCode && String(captureBody.statusCode) !== '00') {
          throw new Error(captureBody.message || 'TransactPay capture failed');
        }
        const verifyResponse = await axios.post(`${this.transactPayBaseUrl()}/payment/order/verify`, { reference: codeClean }, {
          headers: this.transactPayHeaders(),
          timeout: this.TIMEOUT_MS,
        });
        const verifyBody = verifyResponse.data || {};
        const verifyData = verifyBody.data || {};
        const status = String(verifyData.status || verifyData.orderSummary?.status || '').toLowerCase();
        const statusId = Number(verifyData.statusId || verifyData.orderSummary?.statusId || 0);
        if (verifyBody.status === false || (statusId !== 5 && status !== 'successful')) {
          throw new Error(verifyBody.message || verifyData.paymentResponseMessage || 'TransactPay capture was not verified as successful');
        }
        captureResult = {
          provider: 'transactpay',
          capture: captureBody,
          verification: verifyBody,
          captureId: captureBody.data?.captureId || captureBody.data?.reference || verifyData.paymentReference || codeClean,
        };
      } else if (isDryRun) {
        captureResult = {
          success: true,
          dry_run: true,
          captureId: `DRY-CAPTURE-${codeClean}`,
          settlement_id: `DRY-SETTLEMENT-${codeClean}-${currency}`,
          amount,
          currency,
          note: "This is a DRY-RUN capture response (CARD_PROCESSOR_ENABLED=false). No actual POST was made. When ENABLED=true the engine POSTs capture payload above to the pull URL.",
        };
      } else {
        const r2 = await axios.post(this.CAPTURE_URL, capturePayload, {
          headers: this.headersForProcessor(),
          timeout: this.TIMEOUT_MS,
        });
        captureResult = r2.data || { success: true };
        const explicitFail =
          captureResult &&
          (captureResult.success === false || captureResult.ok === false);
        if (explicitFail) {
          throw new Error(
            captureResult?.message || captureResult?.error || "processor capture unsuccessful"
          );
        }
      }
      base.capture_result = captureResult;
      base.run_status = "CAPTURE_SUCCESS";
      const captureId =
        captureResult?.captureId ||
        captureResult?.capture_id ||
        captureResult?.id ||
        captureResult?.settlement_id ||
        captureResult?.ref ||
        uuidv4();
      await this.upsertSettlementRow({
        transaction_id: txn.id,
        status: isDryRun ? "DRY_CAPTURE_SUCCESS" : "REAL_CAPTURE_SUCCESS",
        hold_reason: `${isDryRun ? "DRY-RUN " : ""}capture_ok ref=${String(captureId).slice(0, 36)}`,
        meta: {
          scheme,
          captureResult,
          capturePayload,
          initiated_by: initiatedBy,
          step: isDryRun ? "dry_capture_success" : "capture_success",
          captureId,
        },
        reconciliation_id: captureId,
      });
    } catch (capErr: any) {
      base.run_status = "CAPTURE_FAILED";
      base.error_message =
        capErr?.response?.data?.message ||
        capErr?.message ||
        "real funds capture/pull failed";
      await this.upsertSettlementRow({
        transaction_id: txn.id,
        status: isDryRun ? "DRY_CAPTURE_FAILED" : "REAL_CAPTURE_FAILED",
        hold_reason: String(base.error_message).slice(0, 250),
        meta: {
          scheme,
          error: base.error_message,
          response_body: capErr?.response?.data || null,
          initiated_by: initiatedBy,
          step: isDryRun ? "dry_capture_failed" : "capture_failed",
        },
      });
      return base;
    }
    // ─── Step 3: Credit MERCHANT wallet (SKIP in DRY-RUN mode) ────────
    if (isDryRun) {
      // DO NOT credit, DO NOT update pos2013_transactions status, DO NOT mark COMPLETE
      base.run_status = "PENDING";
      const drySid = await this.upsertSettlementRow({
        transaction_id: txn.id,
        merchant_id: merchantId || txn.merchant_id || null,
        status: "DRY_RUN_COMPLETE_NO_WALLET_LEDGER_CHANGES",
        hold_reason: "CARD_PROCESSOR_ENABLED=false — no wallet credit, no pos status change, no money moved. Flip flag to true after processor verifies lookup/capture payloads above.",
        gross_amount: amount,
        fee_amount: 0,
        net_amount: amount,
        currency,
        meta: {
          scheme,
          lookupResult,
          captureResult,
          initiated_by: initiatedBy,
          step: "dry_run_complete_skip_credit",
          dry_would_have_credited_merchant: merchantId || txn.merchant_id || null,
        },
      });
      base.settlement_id = drySid;
      return base;
    }
    try {
      const captureId =
        captureResult?.captureId ||
        captureResult?.capture_id ||
        captureResult?.id ||
        captureResult?.settlement_id ||
        captureResult?.ref ||
        `AFSE-${codeClean}`;
      const now = new Date().toISOString();
      const merchantSettlementSource = `afse_scheme_${scheme}_settlement`;
      const priorMerchantCredit = await db.query(
        `SELECT id FROM merchant_wallet_transactions
         WHERE source = ? AND reference = ? AND type = 'credit' LIMIT 1`,
        [merchantSettlementSource, captureId]
      );
      if (!priorMerchantCredit.rows?.[0]) {
        await walletsService.creditMerchantWallet(
          merchantId || txn.merchant_id,
          amount,
          merchantSettlementSource,
          captureId,
          currency
        );
      }
      try {
        await db.query(
          `UPDATE pos2013_transactions SET status = 'REAL_SCHEME_SETTLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [txn.id]
        );
      } catch (_) {}
      const sid = await this.upsertSettlementRow({
        transaction_id: txn.id,
        merchant_id: merchantId || txn.merchant_id || null,
        status: "REAL_SCHEME_CREDITED_TO_MERCHANT",
        hold_reason: null,
        gross_amount: amount,
        fee_amount: 0,
        net_amount: amount,
        currency,
        settled_at: now,
        adjusted_at: now,
        reconciliation_id: captureId,
        meta: {
          scheme,
          lookupResult,
          captureResult,
          initiated_by: initiatedBy,
          step: "merchant_credited",
          credited_to_merchant_id: merchantId || txn.merchant_id,
          customer_mapping: resolved?.customer_id || null,
        },
      });
      base.settlement_id = sid;
      base.run_status = "COMPLETE";
      return base;
    } catch (creditErr: any) {
      base.run_status = "CREDIT_FAILED";
      base.error_message = creditErr?.message || "customer wallet credit failed";
      await this.upsertSettlementRow({
        transaction_id: txn.id,
        status: "REAL_MERCHANT_CREDIT_FAILED",
        hold_reason: String(base.error_message).slice(0, 250),
        meta: {
          scheme,
          captureResult,
          error: base.error_message,
          initiated_by: initiatedBy,
          step: "credit_failed",
        },
      });
      return base;
    }
  }

  private emptyState(
    st: AFSERunStatus,
    msg: string,
    code: string = ""
  ): AFSEAuthState {
    return {
      auth_code: code,
      pos_txn_id: null,
      customer_id: null,
      customer_name: null,
      wallet_id: null,
      wallet_code: null,
      amount: 0,
      currency: "USD",
      card_brand: null,
      scheme: "unknown",
      auth_status_in_db: "",
      settled_at: null,
      lookup_result: null,
      capture_result: null,
      settlement_id: null,
      run_status: st,
      error_message: msg,
    };
  }

  async runAll(
    initiatedBy: string = "system"
  ): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    missingCustomer: number;
    results: AFSEAuthState[];
  }> {
    this.refreshEnv();
    const list = await this.findEligiblePosTxns();
    const out: AFSEAuthState[] = [];
    let ok = 0;
    let bad = 0;
    let missing = 0;
    for (const { txn } of list) {
      try {
        const r = await this.runForAuthCode(String(txn.auth_code), initiatedBy);
        out.push(r);
        if (r.run_status === "COMPLETE" || r.run_status === "ALREADY_SETTLED") ok++;
        else if (r.run_status === "MISSING_CUSTOMER_MAPPING") {
          missing++;
          bad++;
        } else bad++;
      } catch (e: any) {
        out.push(this.emptyState("CONFIG_ERROR", e?.message || "unknown", String(txn.auth_code)));
        bad++;
      }
    }
    return { total: list.length, succeeded: ok, failed: bad, missingCustomer: missing, results: out };
  }
}

export const afse = new AutomaticFundSettlementEngine();
