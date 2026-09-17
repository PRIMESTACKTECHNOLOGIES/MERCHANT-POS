import { db } from "../../config/db";
import { settingsService } from "../settings/settings.service";
import { walletsService } from "../wallets/wallets.service";
import { validateTransition, createLedgerEntry, persistLedgerEntry, type TransactionState } from '../ledger/ledger.service';
import { ensureRecoverySchema } from '../reconciliation/recovery-engine.service';
import crypto from "crypto";
import { cashoutsService } from "../cashouts/cashouts.service";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";
import { P2013, explain, buildCode, SystemFamily, SettlementEngineModule, GatewayIntegrationsModule, ActionCode, type ProtocolCode } from "../pos2013/protocol-2013-codes";
import { invoiceReceiptService } from "../receipts/invoice-receipt.service";
import {
  batchExporter,
  type ExportFormat,
  type ExportOpts,
  type ExportResult,
  type BatchRowShape,
  type TxnRowShape,
} from "./batch-exporter";

export class BatchesService {

  private isUsableProcessorUrl(value: string): boolean {
    const url = String(value || '').trim();
    if (!/^https:\/\//i.test(url)) return false;
    return !/(your[-_.]?processor|example\.com|localhost|127\.0\.0\.1)/i.test(url);
  }

  private getProcessorConfig() {
    const LOOKUP_URL = process.env.CARD_PROCESSOR_LOOKUP_URL || "";
    const CAPTURE_URL = process.env.CARD_PROCESSOR_CAPTURE_URL || "";
    const AUTH_HEADER = process.env.CARD_PROCESSOR_AUTH_HEADER || "";
    const TIMEOUT_MS = Number(process.env.CARD_PROCESSOR_TIMEOUT_MS || 15000);
    const MERCHANT_ID_OVERRIDE = process.env.CARD_PROCESSOR_MERCHANT_ID || "";
    const enabledRaw = String(process.env.CARD_PROCESSOR_ENABLED || "false").trim().toLowerCase();
    const ENABLED =
      (enabledRaw === "1" || enabledRaw === "true" || enabledRaw === "on" || enabledRaw === "yes") &&
      this.isUsableProcessorUrl(LOOKUP_URL) && this.isUsableProcessorUrl(CAPTURE_URL);
    return { LOOKUP_URL, CAPTURE_URL, AUTH_HEADER, TIMEOUT_MS, MERCHANT_ID_OVERRIDE, ENABLED };
  }

  private processorHeaders(): Record<string, string> {
    const cfg = this.getProcessorConfig();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (cfg.AUTH_HEADER) headers["Authorization"] = cfg.AUTH_HEADER;
    return headers;
  }

  private inferSchemeFromBrandOrPan(brand: string | null, panMasked: string | null):
    | "visa" | "mastercard" | "unionpay" | "amex" | "unknown" {
    try {
      const brandLower = String(brand || "").toLowerCase().trim();
      if (brandLower.includes("visa")) return "visa";
      if (brandLower.includes("master") || brandLower.includes("mc") || brandLower === "mastercard") return "mastercard";
      if (brandLower.includes("amex") || brandLower.includes("american")) return "amex";
      if (brandLower.includes("union") || brandLower.includes("cup")) return "unionpay";
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
    } catch { return "unknown"; }
  }

  /**
   * Single transaction: processor LOOKUP + CAPTURE (pull real funds).
   * Cardholder bank deducts money here during sync reconciliation.
   * Protocol codes: 1801xx (Gateway / Processor Lookup), 1802xx (Gateway / Processor Capture)
   */
  private async processorLookupAndCapture(
    merchantId: string,
    txn: {
      id: string; local_txn_id: string; batch_id: string; terminal_id: string;
      stan: string; rrn?: string; auth_code?: string;
      amount_minor: number; currency: string; pan_masked: string;
      card_brand?: string; txn_timestamp?: string; created_at?: string;
    }
  ): Promise<{ success: boolean; captureRef?: string; lookupRef?: string; error?: string; events: { code: ProtocolCode; at: string; ref?: string }[] }> {
    const cfg = this.getProcessorConfig();
    const scheme = this.inferSchemeFromBrandOrPan(txn.card_brand || null, txn.pan_masked || null);
    const resolvedMerchantId = cfg.MERCHANT_ID_OVERRIDE || merchantId;
    const amount = Number(txn.amount_minor) / 100;
    const currency = (txn.currency || "USD").toUpperCase();
    const events: { code: ProtocolCode; at: string; ref?: string }[] = [];
    const stamp = () => new Date().toISOString();

    if (!cfg.ENABLED) {
      events.push({ code: P2013.GATEWAY_PROCESSOR_LOOKUP_FAILED, at: stamp(), ref: txn.stan });
      return {
        success: false,
        error: "LIVE_PROCESSOR_REQUIRED: CARD_PROCESSOR_ENABLED=false; transaction blocked and no funds were credited.",
        events,
      };
    }
    if (!cfg.LOOKUP_URL || !cfg.CAPTURE_URL) {
      events.push({ code: P2013.GATEWAY_PROCESSOR_LOOKUP_FAILED, at: stamp(), ref: txn.stan });
      return { success: false, error: `Processor not wired (missing ${!cfg.LOOKUP_URL ? "LOOKUP" : "CAPTURE"}_URL)`, events };
    }

    const lookupPayload = {
      authorization_reference: txn.auth_code || txn.local_txn_id,
      pos_transaction_id: txn.id,
      local_txn_id: txn.local_txn_id,
      batch_id: txn.batch_id,
      terminal_id: txn.terminal_id,
      merchant_id: resolvedMerchantId,
      stan: txn.stan || null,
      rrn: txn.rrn || null,
      amount,
      amount_minor: Number(txn.amount_minor),
      currency,
      card_brand: txn.card_brand || null,
      pan_masked: txn.pan_masked || null,
      scheme,
      txn_timestamp: txn.txn_timestamp || null,
      created_at: txn.created_at || null,
    };

    events.push({ code: P2013.GATEWAY_PROCESSOR_LOOKUP_STARTED, at: stamp(), ref: txn.stan });
    let lookupResult: any = null;
    try {
      const r1 = await axios.post(cfg.LOOKUP_URL, lookupPayload, {
        headers: this.processorHeaders(),
        timeout: cfg.TIMEOUT_MS,
      });
      lookupResult = r1.data || {};
      if (lookupResult && (lookupResult.success === false || lookupResult.ok === false)) {
        events.push({ code: P2013.GATEWAY_PROCESSOR_LOOKUP_FAILED, at: stamp(), ref: txn.stan });
        return { success: false, error: lookupResult.message || "processor lookup declined", events };
      }
      const lookupRef =
        lookupResult?.lookup_id || lookupResult?.id || lookupResult?.ref || `LOOKUP-${txn.stan}`;
      events.push({ code: P2013.GATEWAY_PROCESSOR_LOOKUP_SUCCESS, at: stamp(), ref: lookupRef });
    } catch (err: any) {
      events.push({ code: P2013.GATEWAY_PROCESSOR_LOOKUP_FAILED, at: stamp(), ref: txn.stan });
      return {
        success: false,
        error: `LOOKUP_FAILED: ${err?.response?.data?.message || err?.message || "network error"}`,
        events,
      };
    }

    const pullLocation =
      lookupResult?.funds_location ||
      lookupResult?.funds_held_at ||
      lookupResult?.location ||
      "suspense";
    const lookupRef =
      lookupResult?.lookup_id ||
      lookupResult?.id ||
      lookupResult?.ref ||
      `LOOKUP-${txn.stan}`;

    const capturePayload = {
      authorization_reference: txn.auth_code || txn.local_txn_id,
      lookup_ref: lookupRef,
      funds_location: pullLocation,
      pos_transaction_id: txn.id,
      amount,
      amount_minor: Number(txn.amount_minor),
      currency,
      scheme,
      card_brand: txn.card_brand || null,
      pan_masked: txn.pan_masked || null,
      merchant_id: resolvedMerchantId,
      terminal_id: txn.terminal_id || null,
      batch_id: txn.batch_id || null,
      stan: txn.stan || null,
      rrn: txn.rrn || null,
      txn_timestamp: txn.txn_timestamp || null,
    };

    events.push({ code: P2013.GATEWAY_PROCESSOR_CAPTURE_STARTED, at: stamp(), ref: lookupRef });
    try {
      const r2 = await axios.post(cfg.CAPTURE_URL, capturePayload, {
        headers: this.processorHeaders(),
        timeout: cfg.TIMEOUT_MS,
      });
      const captureResult = r2.data || {};
      const explicitFail = captureResult && (captureResult.success === false || captureResult.ok === false);
      if (explicitFail) {
        events.push({ code: P2013.GATEWAY_PROCESSOR_CAPTURE_FAILED, at: stamp(), ref: lookupRef });
        return { success: false, lookupRef, error: captureResult.message || captureResult.error || "processor capture unsuccessful", events };
      }
      const captureRef =
        captureResult?.captureId ||
        captureResult?.capture_id ||
        captureResult?.id ||
        captureResult?.settlement_id ||
        captureResult?.ref ||
        `CAP-${txn.stan}`;
      events.push({ code: P2013.GATEWAY_PROCESSOR_CAPTURE_SUCCESS, at: stamp(), ref: captureRef });
      return { success: true, captureRef, lookupRef, events };
    } catch (err2: any) {
      events.push({ code: P2013.GATEWAY_PROCESSOR_CAPTURE_FAILED, at: stamp(), ref: lookupRef });
      return {
        success: false,
        lookupRef,
        error: `CAPTURE_FAILED: ${err2?.response?.data?.message || err2?.message || "network error"}`,
        events,
      };
    }
  }

  /**
   * Process offline batch upload — Protocol 201.3
   * Fully SQLite-compatible (no PostgreSQL syntax)
   * IDEMPOTENT: Replaying the same (batchId, merchantId, terminalId) a 2nd time returns
   * the existing settlement code and never double-credits the merchant wallet.
   *
   * FLOW:
   *   1. Idempotency pre-check
   *   2. Verify HMAC signature
   *   3. Insert batch + transactions (status = PENDING_CAPTURE)
   *   4. For each transaction:
   *        a. Processor LOOKUP (find funds in scheme suspense pool)
   *        b. Processor CAPTURE / PULL  ← THIS IS WHEN CARDHOLDER BANK DEDUCTS MONEY
   *        c. Only on successful capture: mark SYNCED, credit merchant wallet
   *   5. Mark batch PROCESSED, save settlement code
   */
  async processOfflineBatch(merchantId: string, terminalId: string, batchData: any) {
    // SQLite-safe schema bootstrap — no-op if columns already exist
    try { await db.query(`ALTER TABLE pos2013_batches ADD COLUMN captured_amount_minor INTEGER DEFAULT 0`); } catch (_) {}
    try { await db.query(`ALTER TABLE pos2013_batches ADD COLUMN captured_count INTEGER DEFAULT 0`); } catch (_) {}
    try { await db.query(`ALTER TABLE pos2013_batches ADD COLUMN failed_count INTEGER DEFAULT 0`); } catch (_) {}
    try { await db.query(`ALTER TABLE pos2013_transactions ADD COLUMN upload_attempts INTEGER DEFAULT 0`); } catch (_) {}
    try { await db.query(`ALTER TABLE ledger_entries ADD COLUMN reference_id TEXT`); } catch (_) {}
    try { await db.query(`ALTER TABLE merchant_pos_settlements ADD COLUMN processor_capture_ref TEXT`); } catch (_) {}
    try { await db.query(`ALTER TABLE merchant_pos_settlements ADD COLUMN processor_lookup_ref TEXT`); } catch (_) {}
    await ensureRecoverySchema(db.query.bind(db)).catch(() => {});

    const protocolEvents: { code: ProtocolCode; at: string; ref?: string; message?: string; amountMinor?: number; currency?: string }[] = [];
    const stamp = () => new Date().toISOString();
    protocolEvents.push({ code: P2013.BATCH_UPLOAD_STARTED, at: stamp(), ref: batchData.batchId, message: `merchant=${merchantId} terminal=${terminalId}` });

    const {
      protocolVersion = "201.3",
      batchId,
      timestamp,
      nonce,
      signature,
      transactions = []
    } = batchData;

    if (protocolVersion !== '201.3' || !batchId || !timestamp || !nonce || !signature) {
      throw new Error('INVALID_PROTOCOL_201_3_REQUEST: protocolVersion, batchId, timestamp, nonce, and signature are required');
    }
    const timestampText = String(timestamp);
    const requestTime = typeof timestamp === 'number'
      ? timestamp
      : /^\d+$/.test(timestampText) ? Number(timestampText) : Date.parse(timestampText);
    if (!Number.isFinite(requestTime) || Math.abs(Date.now() - requestTime) > 10 * 60 * 1000) {
      throw new Error('REPLAY_PROTECTION_FAILED: signed batch timestamp is missing, invalid, or expired');
    }

    // ── 1. Idempotency pre-check: short-circuit if already PROCESSED ─────────
    const priorRes = await db.query(
      `SELECT id, status, settlement_code, signature, nonce, txn_count, total_amount_minor, captured_count, captured_amount_minor, failed_count
         FROM pos2013_batches
        WHERE batch_id = ? AND merchant_id = ? AND terminal_id = ?
        LIMIT 1`,
      [batchId, merchantId, terminalId]
    );
    if (priorRes.rowCount > 0 && (priorRes.rows[0].status === 'PROCESSED' || priorRes.rows[0].status === 'PARTIAL')) {
      const prior = priorRes.rows[0];
      if (prior.signature !== signature || prior.nonce !== nonce) {
        throw new Error('IDEMPOTENCY_CONFLICT: batchId was already used with a different signed request');
      }
      const priorCode = prior.status === 'PROCESSED' ? P2013.BATCH_UPLOAD_SUCCESS : buildCode(SystemFamily.SETTLEMENT_ENGINE, SettlementEngineModule.BATCH_UPLOAD, ActionCode.PENDING);
      protocolEvents.push({ code: priorCode, at: stamp(), ref: prior.settlement_code, message: `idempotent replay: ${prior.status}` });
      console.log(`[P2013 | ${P2013.BATCH_UPLOAD_SUCCESS}] Batch ${batchId} replay detected (status=${prior.status}) — returning prior settlement (safe idempotency).`);
      return {
        success: true,
        replayed: true,
        batchId,
        settlementCode: prior.settlement_code,
        txnCount: Number(prior.txn_count || 0),
        totalAmountMinor: Number(prior.total_amount_minor || 0),
        capturedCount: Number(prior.captured_count || 0),
        capturedAmountMinor: Number(prior.captured_amount_minor || 0),
        failedCount: Number(prior.failed_count || 0),
        batchStatus: prior.status,
        captureErrors: [],
        processorMode: this.getProcessorConfig().ENABLED ? 'LIVE' : 'DRY-RUN',
        protocolLastCode: priorCode,
        protocolEvents,
      };
    }

    // ── 2. Verify HMAC signature ─────────────────────────────────────────────
    // Prefer per-terminal secret (stronger, per-device revocation) with merchant
    // api_key fallback for terminals registered before this patch.
    let secretKey: string | null = null;
    const termRes = await db.query(
      `SELECT terminal_secret FROM terminals WHERE terminal_id = ? AND merchant_id = ? LIMIT 1`,
      [terminalId, merchantId]
    );
    if (termRes.rowCount > 0 && termRes.rows[0].terminal_secret) {
      secretKey = termRes.rows[0].terminal_secret;
    } else {
      const settings = await settingsService.getSettings(merchantId);
      secretKey = settings.api_key || null;
    }
    if (!secretKey) {
      throw new Error("Merchant/terminal secret key is not configured");
    }

    // timestamp may arrive as a number (ms) or ISO string — normalise to string
    const tsString = typeof timestamp === "number" ? String(timestamp) : String(timestamp);

    const expectedSignature = this.generateHmacSignature(
      protocolVersion, merchantId, terminalId, batchId,
      tsString, nonce, transactions.length, secretKey
    );

    const suppliedSignature = Buffer.from(String(signature), 'base64');
    const expectedSignatureBytes = Buffer.from(expectedSignature, 'base64');
    if (suppliedSignature.length !== expectedSignatureBytes.length ||
      !crypto.timingSafeEqual(suppliedSignature, expectedSignatureBytes)) {
      const failCode = P2013.BATCH_UPLOAD_FAILED;
      protocolEvents.push({ code: failCode, at: stamp(), ref: batchId, message: `HMAC signature mismatch` });
      console.warn(`[P2013 | ${failCode}] Batch ${batchId} signature invalid or missing — expected=${expectedSignature} got=${signature}`);
      throw new Error("Invalid or missing signature");
    }

    const requestHash = crypto.createHash('sha256')
      .update(JSON.stringify({ protocolVersion, merchantId, terminalId, batchId, timestamp, nonce, transactions }))
      .digest('hex');
    const replayInsert = await db.query(
      `INSERT OR IGNORE INTO protocol_replay_nonces
       (merchant_id, terminal_id, nonce, batch_id, request_hash)
       VALUES (?, ?, ?, ?, ?)`,
      [merchantId, terminalId, nonce, batchId, requestHash]
    );
    if (replayInsert.rowCount === 0) {
      throw new Error('REPLAY_PROTECTION_FAILED: nonce has already been used');
    }

    protocolEvents.push({ code: P2013.BATCH_BUILD_STARTED, at: stamp(), ref: batchId, message: `${transactions.length} transactions in payload` });

    const totalAmountMinor = transactions.reduce(
      (sum: number, txn: any) => sum + (Number(txn.amountMinor) || 0), 0
    );

    const settlementCode = String(Math.floor(100000 + Math.random() * 900000));
    const batchRowId = uuidv4();
    const now = new Date().toISOString();

    // ── 3. Insert batch (INSERT OR IGNORE for idempotency) ───────────────────
    const insertRes = await db.query(`
      INSERT OR IGNORE INTO pos2013_batches
        (id, batch_id, merchant_id, terminal_id, protocol_version, status,
         settlement_code, txn_count, total_amount_minor, signature, nonce,
         upload_timestamp, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'RECEIVED', ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      batchRowId, batchId, merchantId, terminalId, protocolVersion,
      settlementCode, transactions.length, totalAmountMinor,
      signature || "", nonce || "", now, now, now
    ]);
    const actuallyInserted = Number(insertRes.rowCount || 0) > 0;
    // If INSERT OR IGNORE skipped AND we already have a PROCESSED row at final
    // check (race with concurrent upload), return prior settlement safely.
    if (!actuallyInserted) {
      const recheck = await db.query(
        `SELECT status, settlement_code, txn_count, total_amount_minor, captured_count, captured_amount_minor, failed_count
           FROM pos2013_batches WHERE batch_id = ? AND merchant_id = ? AND terminal_id = ? LIMIT 1`,
        [batchId, merchantId, terminalId]
      );
      if (recheck.rowCount > 0 && (recheck.rows[0].status === 'PROCESSED' || recheck.rows[0].status === 'PARTIAL')) {
        const p = recheck.rows[0];
        const rc = p.status === 'PROCESSED' ? P2013.BATCH_UPLOAD_SUCCESS : buildCode(SystemFamily.SETTLEMENT_ENGINE, SettlementEngineModule.BATCH_UPLOAD, ActionCode.PENDING);
        protocolEvents.push({ code: rc, at: stamp(), ref: p.settlement_code, message: `idempotent concurrent race: ${p.status}` });
        console.log(`[P2013 | ${rc}] Concurrent race for ${batchId} resolved idempotently (status=${p.status}).`);
        return {
          success: true,
          replayed: true,
          batchId,
          settlementCode: p.settlement_code,
          txnCount: Number(p.txn_count || 0),
          totalAmountMinor: Number(p.total_amount_minor || 0),
          capturedCount: Number(p.captured_count || 0),
          capturedAmountMinor: Number(p.captured_amount_minor || 0),
          failedCount: Number(p.failed_count || 0),
          batchStatus: p.status,
          captureErrors: [],
          processorMode: this.getProcessorConfig().ENABLED ? 'LIVE' : 'DRY-RUN',
          protocolLastCode: rc,
          protocolEvents,
        };
      }
    }
    protocolEvents.push({ code: P2013.BATCH_BUILD_SUCCESS, at: stamp(), ref: batchId, message: `rows inserted, totalAmountMinor=${totalAmountMinor}` });

    // ── 4. Insert transactions (INSERT OR IGNORE for idempotency) ────────────
    //     Status starts as PENDING_CAPTURE — processor pull happens NEXT.
    const insertedTxns: Array<{
      id: string; local_txn_id: string; batch_id: string; terminal_id: string;
      stan: string; rrn?: string; auth_code?: string;
      amount_minor: number; currency: string; pan_masked: string;
      card_brand?: string; txn_timestamp: string; created_at: string;
      amount: number;
    }> = [];

    for (const txn of transactions) {
      const txnId = txn.id || uuidv4();
      const localTxnId = txn.localTxnId || `LOCAL-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const txnTimestamp = txn.txnTimestamp || txn.timestamp
        ? new Date(txn.txnTimestamp || txn.timestamp).toISOString()
        : now;
      const txnAmountMinor = Number(txn.amountMinor) || 0;
      const txnAmount = txnAmountMinor / 100;
      const txnCurrency = (txn.currency || "USD").toUpperCase();

      await db.query(`
        INSERT OR IGNORE INTO pos2013_transactions
          (id, merchant_id, terminal_id, batch_id, local_txn_id, stan,
           amount_minor, currency, pan_masked, txn_type, auth_mode,
           entry_mode, card_brand, reader_source, cvm_result, pin_verified,
           status, emv_data, txn_timestamp, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_CAPTURE', ?, ?, ?)
      `, [
        txnId, merchantId, terminalId, batchId, localTxnId,
        txn.stan || "000000",
        txnAmountMinor,
        txnCurrency,
        txn.panMasked || "****",
        txn.txnType || "SALE",
        txn.authMode || "OFFLINE_APPROVED",
        txn.entryMode || "MANUAL",
        txn.cardBrand || null,
        txn.readerSource || null,
        txn.cvmResult || null,
        txn.pinVerified ? 1 : 0,
        txn.emvData ? JSON.stringify(txn.emvData) : null,
        txnTimestamp, now
      ]);

      await invoiceReceiptService.create({
        type: 'POS_INVOICE', sourceTable: 'pos2013_transactions', sourceId: txnId,
        merchantId, amount: txnAmount, currency: txnCurrency, status: 'PENDING_CAPTURE',
        reference: txn.rrn || txn.stan || txnId, description: 'Offline batch POS invoice',
        details: { batchId, localTxnId, stan: txn.stan || '000000', terminalId },
      });

      await db.query(`
        INSERT OR IGNORE INTO offline_funds_receipts
          (id, merchant_id, terminal_id, transaction_id, stan, amount_minor, currency, status, receipt_payload, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING_CAPTURE', ?, ?, ?)
      `, [
        uuidv4(),
        merchantId,
        terminalId,
        txnId,
        txn.stan || "000000",
        txnAmountMinor,
        txnCurrency,
        JSON.stringify({
          batchId,
          localTxnId,
          stan: txn.stan || "000000",
          amountMinor: txnAmountMinor,
          currency: txnCurrency,
          terminalId,
          merchantId,
          receivedAt: now,
          source: 'offline-pos'
        }),
        now,
        now
      ]);

      const ledgerEntry = createLedgerEntry(
        txnId,
        'credit',
        txnAmount,
        txnCurrency,
        'AUTHORIZED',
        `Offline batch transaction ${localTxnId}`,
        merchantId,
        'pos',
        localTxnId,
        undefined,
        batchId
      );
      validateTransition('PENDING', ledgerEntry.status as TransactionState);
      await persistLedgerEntry(ledgerEntry, db.query.bind(db));

      // Settlement record: mark this POS sale "unsettled" until real money arrives.
      // Allows reconciliation in the settlement module later (mark settled / adjusted).
      const settlementId = uuidv4();
      const settlementMeta = JSON.stringify({
        stan: txn.stan || null,
        rrn: txn.rrn || null,
        card_masked: txn.panMasked || null,
        local_txn_id: localTxnId,
        batch_id: batchId,
        terminal_id: terminalId,
      });
      await db.query(
        `INSERT INTO merchant_pos_settlements
         (id, merchant_id, ledger_entry_id, amount, currency, status, created_at, meta)
         VALUES (?, ?, ?, ?, ?, 'unsettled', CURRENT_TIMESTAMP, ?)`,
        [settlementId, merchantId, ledgerEntry.id, txnAmount, txnCurrency, settlementMeta]
      );

      insertedTxns.push({
        id: txnId, local_txn_id: localTxnId, batch_id: batchId, terminal_id: terminalId,
        stan: txn.stan || "000000", rrn: txn.rrn,
        amount_minor: txnAmountMinor, currency: txnCurrency,
        pan_masked: txn.panMasked || "****", card_brand: txn.cardBrand,
        txn_timestamp: txnTimestamp, created_at: now,
        amount: txnAmount,
      });
    }

    // ── 5. Processor LOOKUP + CAPTURE per transaction — CARDHOLDER $ DEDUCTS HERE ─
    protocolEvents.push({ code: P2013.BATCH_RECONCILE_STARTED, at: stamp(), ref: batchId, message: `capturing ${insertedTxns.length} transactions` });
    let capturedAmountMinor = 0;
    let capturedCount = 0;
    let failedCount = 0;
    const captureErrors: string[] = [];

    for (const txn of insertedTxns) {
      const capture = await this.processorLookupAndCapture(merchantId, txn);
      protocolEvents.push(...capture.events.map(e => ({ ...e, amountMinor: txn.amount_minor, currency: txn.currency })));
      if (capture.success) {
        // Cardholder bank has deducted. Now: mark SYNCED + credit merchant wallet.
        const useAuthCode = capture.captureRef && /^[0-9]{6}$/.test(capture.captureRef)
          ? capture.captureRef
          : settlementCode;
        await db.query(`
          UPDATE pos2013_transactions
          SET status = 'SYNCED', auth_code = ?, updated_at = ?
          WHERE id = ?
        `, [useAuthCode, now, txn.id]);

        await db.query(`
          UPDATE offline_funds_receipts
          SET status = 'SYNCED', synced_at = ?, updated_at = ?
          WHERE transaction_id = ?
        `, [now, now, txn.id]);

        protocolEvents.push({ code: P2013.WALLET_CREDIT_STARTED, at: stamp(), ref: txn.id, amountMinor: txn.amount_minor, currency: txn.currency });
        const walletRes = await walletsService.creditMerchantWallet(
          merchantId,
          txn.amount,
          'offline_batch_processor_settlement',
          capture.captureRef || settlementCode,
          txn.currency
        );
        const walletOk = walletRes && (walletRes as any).success !== false;
        protocolEvents.push({
          code: walletOk ? P2013.WALLET_CREDIT_SUCCESS : P2013.WALLET_CREDIT_FAILED,
          at: stamp(), ref: (walletRes as any)?.id || (walletRes as any)?.entryId || txn.id,
          amountMinor: txn.amount_minor, currency: txn.currency
        });
        if (walletOk) {
          protocolEvents.push({
            code: P2013.WALLET_CREDIT_CREDITED, at: stamp(),
            ref: (walletRes as any)?.id || (walletRes as any)?.entryId || capture.captureRef,
            amountMinor: txn.amount_minor, currency: txn.currency
          });
        }

        protocolEvents.push({ code: P2013.EMV_OFFLINE_SYNC_COMPLETED, at: stamp(), ref: txn.id, amountMinor: txn.amount_minor, currency: txn.currency });

        try {
          await db.query(
            `UPDATE merchant_pos_settlements
             SET status = 'settled', settled_at = ?, updated_at = ?, meta = JSON_SET(COALESCE(meta,'{}'), '$.processor_capture_ref', ?, '$.processor_lookup_ref', ?)
             WHERE merchant_id = ? AND ledger_entry_id IN (
               SELECT id FROM ledger_entries WHERE COALESCE(reference_id, transaction_id) = ?
             )`,
            [now, now, capture.captureRef || null, capture.lookupRef || null, merchantId, txn.id]
          );
        } catch (_settleUpdate) {
          /* settlement audit row is best-effort only — don't fail critical capture */
        }

        capturedAmountMinor += txn.amount_minor;
        capturedCount++;
      } else {
        // Processor unreachable / declined: leave PENDING_CAPTURE for retry
        failedCount++;
        captureErrors.push(`STAN=${txn.stan}: ${capture.error || "capture failed"}`);
        try {
          await db.query(`
            UPDATE pos2013_transactions
            SET status = 'CAPTURE_FAILED', auth_code = COALESCE(auth_code, ?), updated_at = ?
            WHERE id = ? AND status = 'PENDING_CAPTURE'
          `, [settlementCode, now, txn.id]);
        } catch (_) {
          await db.query(`
            UPDATE pos2013_transactions
            SET status = 'PENDING_CAPTURE', updated_at = ?
            WHERE id = ?
          `, [now, txn.id]);
        }
        try {
          await db.query(`
            UPDATE offline_funds_receipts
            SET status = 'CAPTURE_FAILED', updated_at = ?
            WHERE transaction_id = ?
          `, [now, txn.id]);
        } catch (_) {}
      }
    }

    // ── 6. Mark batch PROCESSED and save settlement code ─────────────────────
    //     If some captures failed, batch status = PARTIAL; if all failed = CAPTURE_FAILED.
    const allInserted = insertedTxns.length;
    let finalBatchStatus = 'PROCESSED';
    let finalProtocolCode: ProtocolCode = P2013.BATCH_UPLOAD_SUCCESS;
    if (failedCount > 0 && capturedCount === 0) { finalBatchStatus = 'CAPTURE_FAILED'; finalProtocolCode = P2013.BATCH_UPLOAD_FAILED; }
    else if (failedCount > 0) { finalBatchStatus = 'PARTIAL'; finalProtocolCode = buildCode(SystemFamily.SETTLEMENT_ENGINE, SettlementEngineModule.BATCH_RECONCILE, ActionCode.PENDING); }
    else finalProtocolCode = P2013.BATCH_RECONCILE_SUCCESS;

    await db.query(`
      UPDATE pos2013_batches
      SET status = ?, settlement_code = ?,
          processed_at = ?, updated_at = ?,
          captured_amount_minor = ?, captured_count = ?, failed_count = ?
      WHERE batch_id = ? AND merchant_id = ? AND terminal_id = ?
    `, [
      finalBatchStatus, settlementCode, now, now,
      capturedAmountMinor, capturedCount, failedCount,
      batchId, merchantId, terminalId
    ]);
    protocolEvents.push({
      code: finalProtocolCode, at: stamp(), ref: settlementCode,
      amountMinor: capturedAmountMinor,
      message: `status=${finalBatchStatus} captured=${capturedCount}/${allInserted} failed=${failedCount}`
    });

    const cfg = this.getProcessorConfig();
    console.log(`[P2013 | ${finalProtocolCode}] Batch ${batchId} ${finalBatchStatus}. ` +
      `captured=${capturedCount}/${allInserted} ($${(capturedAmountMinor/100).toFixed(2)}), ` +
      `failed=${failedCount}, settlement=${settlementCode}, ` +
      `processor=${cfg.ENABLED ? 'LIVE' : 'DRY-RUN'}`);
    if (captureErrors.length > 0) {
      console.warn(`[P2013 | ${buildCode(SystemFamily.SETTLEMENT_ENGINE, SettlementEngineModule.BATCH_RECONCILE, ActionCode.FAILED)}] Capture failures in batch ${batchId}:`, captureErrors);
    }

    return {
      success: true,
      replayed: false,
      batchId,
      settlementCode,
      txnCount: transactions.length,
      totalAmountMinor,
      capturedCount,
      capturedAmountMinor,
      failedCount,
      batchStatus: finalBatchStatus,
      captureErrors: captureErrors.slice(0, 25),
      processorMode: this.getProcessorConfig().ENABLED ? 'LIVE' : 'DRY-RUN',
      protocolLastCode: finalProtocolCode,
      protocolLastMeaning: explain(finalProtocolCode),
      protocolEvents,
    };
  }

  /**
   * HMAC-SHA256 — must match client crypto.ts implementation exactly.
   * Payload: protocolVersion|merchantId|terminalId|batchId|timestamp|nonce|count
   */
  private generateHmacSignature(
    protocolVersion: string, merchantId: string, terminalId: string,
    batchId: string, timestamp: string, nonce: string,
    transactionCount: number, secretKey: string
  ): string {
    const data = `${protocolVersion}|${merchantId}|${terminalId}|${batchId}|${timestamp}|${nonce}|${transactionCount}`;
    return crypto.createHmac("sha256", secretKey).update(data).digest("base64");
  }

  async syncOfflineFundsReceipts(merchantId: string, terminalId?: string) {
    const params: any[] = [merchantId];
    let where = 'WHERE merchant_id = ?';

    if (terminalId) {
      where += ' AND terminal_id = ?';
      params.push(terminalId);
    }

    const pendingRes = await db.query(`
      SELECT id, transaction_id, stan, amount_minor, currency, receipt_payload
      FROM offline_funds_receipts
      ${where}
      AND status = 'PENDING'
      ORDER BY created_at ASC
    `, params);

    const synced: any[] = [];
    for (const row of pendingRes.rows) {
      const payload = row.receipt_payload ? JSON.parse(row.receipt_payload) : {};
      const now = new Date().toISOString();

      await db.query(`
        UPDATE offline_funds_receipts
        SET status = 'SYNCED', synced_at = ?, updated_at = ?
        WHERE id = ?
      `, [now, now, row.id]);

      await walletsService.creditMerchantWallet(
        merchantId,
        Number(row.amount_minor || 0) / 100,
        'offline_sync_receipt',
        row.stan || row.transaction_id || row.id
      );

      synced.push({
        id: row.id,
        transactionId: row.transaction_id,
        stan: row.stan,
        amountMinor: row.amount_minor,
        currency: row.currency,
        payload
      });
    }

    return {
      success: true,
      merchantId,
      terminalId: terminalId || null,
      syncedCount: synced.length,
      items: synced
    };
  }

  /**
   * Retry processor capture for transactions stuck in PENDING_CAPTURE or CAPTURE_FAILED.
   * Called by: background worker / "Retry Failed Captures" button in dashboard.
   * Cardholder bank deducts funds here on successful retry.
   */
  async retryFailedCaptures(params: {
    merchantId: string;
    terminalId?: string;
    maxRetries?: number;
  }) {
    const { merchantId, terminalId, maxRetries = 10 } = params;
    const now = new Date().toISOString();
    const protocolEvents: { code: ProtocolCode; at: string; ref?: string; message?: string; amountMinor?: number; currency?: string }[] = [];
    const stamp = () => new Date().toISOString();

    try { await db.query(`ALTER TABLE pos2013_batches ADD COLUMN captured_amount_minor INTEGER DEFAULT 0`); } catch (_) {}
    try { await db.query(`ALTER TABLE pos2013_batches ADD COLUMN captured_count INTEGER DEFAULT 0`); } catch (_) {}
    try { await db.query(`ALTER TABLE pos2013_batches ADD COLUMN failed_count INTEGER DEFAULT 0`); } catch (_) {}
    try { await db.query(`ALTER TABLE ledger_entries ADD COLUMN reference_id TEXT`); } catch (_) {}
    await ensureRecoverySchema(db.query.bind(db)).catch(() => {});

    const p: any[] = [merchantId];
    let where = `WHERE t.merchant_id = ? AND t.status IN ('PENDING_CAPTURE','CAPTURE_FAILED')`;
    if (terminalId) { where += ` AND t.terminal_id = ?`; p.push(terminalId); }
    where += ` AND (COALESCE(t.upload_attempts,0) < ?)`; p.push(maxRetries);
    where += ` ORDER BY t.created_at ASC LIMIT 100`;

    const txnRes = await db.query(`
      SELECT t.id, t.local_txn_id, t.batch_id, t.terminal_id, t.stan, t.rrn,
             t.auth_code, t.amount_minor, t.currency, t.pan_masked, t.card_brand,
             t.txn_timestamp, t.created_at, b.settlement_code
      FROM pos2013_transactions t
      LEFT JOIN pos2013_batches b ON b.batch_id = t.batch_id AND b.merchant_id = t.merchant_id
      ${where}
    `, p);

    const txns = txnRes.rows || [];
    protocolEvents.push({
      code: P2013.BATCH_RECONCILE_STARTED, at: stamp(),
      ref: `retry-capture-${merchantId.slice(0, 8)}`,
      message: `retrying ${txns.length} captures`
    });
    if (txns.length === 0) {
      protocolEvents.push({ code: P2013.BATCH_RECONCILE_SUCCESS, at: stamp(), message: "nothing to retry" });
      return { success: true, merchantId, retried: 0, captured: 0, failed: 0, message: "No pending captures to retry.", protocolLastCode: P2013.BATCH_RECONCILE_SUCCESS, protocolLastMeaning: explain(P2013.BATCH_RECONCILE_SUCCESS), protocolEvents };
    }

    let captured = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const t of txns as any[]) {
      const settlementCode = t.settlement_code || `SETTLE-${Date.now()}`;
      const capture = await this.processorLookupAndCapture(merchantId, {
        id: t.id, local_txn_id: t.local_txn_id, batch_id: t.batch_id, terminal_id: t.terminal_id,
        stan: t.stan || "000000", rrn: t.rrn, auth_code: t.auth_code || t.local_txn_id,
        amount_minor: Number(t.amount_minor), currency: t.currency || "USD",
        pan_masked: t.pan_masked || "****", card_brand: t.card_brand,
        txn_timestamp: t.txn_timestamp, created_at: t.created_at,
      });
      protocolEvents.push(...capture.events.map(e => ({ ...e, amountMinor: Number(t.amount_minor), currency: t.currency || "USD" })));
      if (capture.success) {
        const useAuthCode = capture.captureRef && /^[0-9]{6}$/.test(capture.captureRef)
          ? capture.captureRef
          : settlementCode;
        await db.query(`
          UPDATE pos2013_transactions
          SET status = 'SYNCED', auth_code = ?, updated_at = ?
          WHERE id = ?
        `, [useAuthCode, now, t.id]);
        await db.query(`
          UPDATE offline_funds_receipts
          SET status = 'SYNCED', synced_at = ?, updated_at = ?
          WHERE transaction_id = ?
        `, [now, now, t.id]);
        const amount = Number(t.amount_minor) / 100;
        protocolEvents.push({ code: P2013.WALLET_CREDIT_STARTED, at: stamp(), ref: t.id, amountMinor: Number(t.amount_minor), currency: t.currency || "USD" });
        const wRes = await walletsService.creditMerchantWallet(
          merchantId, amount, 'offline_batch_retry_settlement',
          capture.captureRef || settlementCode, t.currency || "USD"
        );
        const wOk = wRes && (wRes as any).success !== false;
        protocolEvents.push({ code: wOk ? P2013.WALLET_CREDIT_SUCCESS : P2013.WALLET_CREDIT_FAILED, at: stamp(), ref: (wRes as any)?.id || t.id, amountMinor: Number(t.amount_minor), currency: t.currency || "USD" });
        if (wOk) protocolEvents.push({ code: P2013.WALLET_CREDIT_CREDITED, at: stamp(), ref: capture.captureRef, amountMinor: Number(t.amount_minor), currency: t.currency || "USD" });
        protocolEvents.push({ code: P2013.EMV_OFFLINE_SYNC_COMPLETED, at: stamp(), ref: t.id, amountMinor: Number(t.amount_minor), currency: t.currency || "USD" });
        try {
          await db.query(`
            UPDATE merchant_pos_settlements
            SET status = 'settled', settled_at = ?, updated_at = ?,
                meta = JSON_SET(COALESCE(meta,'{}'), '$.processor_capture_ref', ?, '$.processor_lookup_ref', ?, '$.retry_capture', 'true')
            WHERE merchant_id = ? AND ledger_entry_id IN (
              SELECT id FROM ledger_entries WHERE COALESCE(reference_id, transaction_id) = ?
            )
          `, [now, now, capture.captureRef || null, capture.lookupRef || null, merchantId, t.id]);
        } catch (_settleUpdateRetry) {
          /* settlement audit best-effort only */
        }
        await db.query(`
          UPDATE pos2013_batches SET
            captured_amount_minor = COALESCE(captured_amount_minor,0) + ?,
            captured_count = COALESCE(captured_count,0) + 1,
            failed_count = MAX(0, COALESCE(failed_count,0) - 1),
            updated_at = ?
          WHERE batch_id = ? AND merchant_id = ?
        `, [Number(t.amount_minor), now, t.batch_id, merchantId]);
        captured++;
      } else {
        failed++;
        errors.push(`TXN=${t.id.slice(0,8)} STAN=${t.stan}: ${capture.error || "capture failed"}`);
        await db.query(`
          UPDATE pos2013_transactions
          SET status = 'CAPTURE_FAILED',
              upload_attempts = COALESCE(upload_attempts,0) + 1,
              updated_at = ?
          WHERE id = ?
        `, [now, t.id]);
      }
    }

    const batchIds = [...new Set((txns as any[]).map((t: any) => t.batch_id).filter(Boolean))];
    for (const bid of batchIds) {
      await db.query(`
        UPDATE pos2013_batches SET
          status = CASE
            WHEN COALESCE(failed_count,0) = 0 AND COALESCE(captured_count,0) > 0 THEN 'PROCESSED'
            WHEN COALESCE(failed_count,0) > 0 AND COALESCE(captured_count,0) = 0 THEN 'CAPTURE_FAILED'
            WHEN COALESCE(failed_count,0) > 0 THEN 'PARTIAL'
            ELSE status
          END,
          updated_at = ?
        WHERE batch_id = ? AND merchant_id = ?
      `, [now, bid, merchantId]);
    }
    const finalCode: ProtocolCode = failed === 0
      ? P2013.BATCH_RECONCILE_SUCCESS
      : (captured > 0
        ? buildCode(SystemFamily.SETTLEMENT_ENGINE, SettlementEngineModule.BATCH_RECONCILE, ActionCode.PENDING)
        : P2013.BATCH_UPLOAD_FAILED);
    protocolEvents.push({ code: finalCode, at: stamp(), message: `retried=${txns.length} captured=${captured} failed=${failed}` });
    console.log(`[P2013 | ${finalCode}] retryFailedCaptures merchant=${merchantId.slice(0, 8)} retried=${txns.length} captured=${captured} failed=${failed}`);

    return {
      success: true,
      merchantId,
      retried: txns.length,
      captured,
      failed,
      processorMode: this.getProcessorConfig().ENABLED ? 'LIVE' : 'DRY-RUN',
      errors: errors.slice(0, 50),
      protocolLastCode: finalCode,
      protocolLastMeaning: explain(finalCode),
      protocolEvents,
    };
  }

  /**
   * Redeem a payment code
   * Checks payment_codes table first (6-digit offline settlement codes),
   * then checks batch settlement codes if the local code is not found.
   */
  async redeemPaymentCode(payload: { code: string; amount: number; merchantId: string }) {
    const { code, amount, merchantId } = payload;
    const amountMinor = Math.round(amount * 100);

    // ── Check local payment_codes table first ─────────────────────────────────
    const codeRes = await db.query(
      `SELECT * FROM payment_codes WHERE code = ? AND used = 0`,
      [code]
    );

    if (codeRes.rowCount > 0) {
      const pc = codeRes.rows[0];

      // Amount tolerance ±1 minor unit for floating-point drift
      if (Math.abs(pc.amount_minor - amountMinor) > 1) {
        return {
          success: false,
          message: `Amount mismatch — code is for ${(pc.amount_minor / 100).toFixed(2)} ${pc.currency}`
        };
      }

      const now = new Date().toISOString();
      await db.query(
        `UPDATE payment_codes SET used = 1, used_at = ?, used_by_merchant = ? WHERE code = ?`,
        [now, merchantId, code]
      );

      await db.query(
        `UPDATE pos2013_transactions SET status = 'REDEEMED' WHERE auth_code = ? AND merchant_id = ?`,
        [code, merchantId]
      ).catch(() => {}); // non-fatal

      return {
        success: true,
        message: "Payment successful",
        reference: pc.reference || pc.id,
        time: now
      };
    }

    // ── Settlement code from pos2013_batches ──────────────────────────────────
    const batchRes = await db.query(
      `SELECT * FROM pos2013_batches WHERE settlement_code = ? AND merchant_id = ?`,
      [code, merchantId]
    );

    if (batchRes.rowCount > 0) {
      const batch = batchRes.rows[0];
      const totalMinor = batch.total_amount_minor || 0;

      if (totalMinor > 0 && Math.abs(totalMinor - amountMinor) > amountMinor * 0.1) {
        return {
          success: false,
          message: `Amount mismatch — batch total is ${(totalMinor / 100).toFixed(2)}`
        };
      }

      const now = new Date().toISOString();
      await db.query(`UPDATE pos2013_batches SET status = 'REDEEMED', updated_at = ? WHERE settlement_code = ? AND merchant_id = ?`, [now, code, merchantId]);
      await db.query(`UPDATE pos2013_transactions SET status = 'REDEEMED' WHERE batch_id = ? AND merchant_id = ?`, [batch.batch_id, merchantId]).catch(() => {});

      return {
        success: true,
        message: "Batch settlement redeemed",
        reference: batch.batch_id,
        time: now
      };
    }

    return { success: false, message: "Invalid or expired code" };
  }

  async cashoutBraintree(merchantId: string, batches: any[]) {
    const batchIds = batches
      .map((batch: any) => batch.batchId || batch.id)
      .filter((id: string) => !!id);

    if (batchIds.length === 0) {
      throw new Error("No batch IDs provided for cashout");
    }

    const cashout = await cashoutsService.createCashout(merchantId, batchIds);
    const processed = await cashoutsService.processCashout(cashout.cashoutId, merchantId);

    return {
      synced: batchIds.length,
      failed: 0,
      details: [processed],
      mode: "LIVE",
      message: "Cashout created and processed successfully"
    };
  }

  async getBatches(merchantId?: string) {
    try {
      const params: any[] = [];
      let where = "";
      if (merchantId) { where = "WHERE b.merchant_id = ?"; params.push(merchantId); }

      const res = await db.query(`
        SELECT b.id, b.batch_id, b.merchant_id, b.terminal_id,
               b.status, b.txn_count, b.total_amount_minor,
               b.settlement_code, b.upload_timestamp, b.protocol_version,
               b.batch_seq, b.processed_at
        FROM pos2013_batches b
        ${where}
        ORDER BY b.upload_timestamp DESC
        LIMIT 200
      `, params);
      return res.rows;
    } catch (e) {
      console.error("getBatches error:", e);
      return [];
    }
  }

  async getTransactions(merchantId?: string, limit: number = 100) {
    try {
      const params: any[] = [];
      let where = "";
      if (merchantId) { where = "WHERE t.merchant_id = ?"; params.push(merchantId); }
      params.push(limit);

      const res = await db.query(`
        SELECT t.id, t.stan, t.amount_minor, t.currency, t.pan_masked,
               t.status, t.txn_timestamp, t.terminal_id, t.batch_id,
               t.txn_type, t.auth_mode, t.entry_mode, t.auth_code,
               t.local_txn_id, t.created_at, t.rrn, t.card_brand,
               t.reader_source, t.cvm_result, t.pin_verified
        FROM pos2013_transactions t
        ${where}
        ORDER BY t.created_at DESC
        LIMIT ?
      `, params);

      return res.rows.map((row: any) => ({
        ...row,
        amountMinor: row.amount_minor,
        amount: (row.amount_minor / 100).toFixed(2)
      }));
    } catch (e) {
      console.error("getTransactions error:", e);
      return [];
    }

  }

  async setTransactionAuthCode(transactionId: string, authCode: string) {
    const normalizedId = String(transactionId || '').trim();
    const normalizedCode = String(authCode || '').trim().toUpperCase();
    if (!normalizedId) throw new Error('Transaction ID is required');
    if (!/^[A-Z0-9]{4,12}$/.test(normalizedCode) || normalizedCode === '0000') {
      throw new Error('Authorization code must be 4-12 letters or numbers and cannot be 0000');
    }

    const transaction = await db.query(
      `SELECT t.id, t.batch_id, b.settlement_code
       FROM pos2013_transactions t
       LEFT JOIN pos2013_batches b ON b.batch_id = t.batch_id
       WHERE t.id = ?
       LIMIT 1`,
      [normalizedId],
    );
    if (!transaction.rowCount) throw new Error('Offline transaction not found');
    const expectedCode = String(transaction.rows[0].settlement_code || '').trim().toUpperCase();
    if (!expectedCode) throw new Error('No issued authorization code exists for this transaction batch');
    if (normalizedCode !== expectedCode) throw new Error('Authorization code does not match the issued transaction code');

    const result = await db.query(
      `UPDATE pos2013_transactions
       SET auth_code = ?
       WHERE id = ?`,
      [normalizedCode, normalizedId],
    );
    if (!result.rowCount) throw new Error('Offline transaction not found');
    return { transactionId: normalizedId, authCode: normalizedCode };
  }

  private async resolveSecret(merchantId: string, terminalId: string): Promise<string> {
    const termRes = await db.query(
      `SELECT terminal_secret FROM terminals WHERE terminal_id = ? AND merchant_id = ? LIMIT 1`,
      [terminalId, merchantId]
    );
    if (termRes.rowCount && termRes.rows[0].terminal_secret) return termRes.rows[0].terminal_secret;
    const settings = await settingsService.getSettings(merchantId);
    if (settings.api_key) return settings.api_key;
    throw new Error("Merchant/terminal secret key is not configured");
  }

  async getBatchDetails(batchId: string, merchantId?: string) {
    const params: any[] = [batchId];
    let where = "WHERE b.batch_id = ?";
    if (merchantId) { where += " AND b.merchant_id = ?"; params.push(merchantId); }

    const batchRes = await db.query(`
      SELECT b.* FROM pos2013_batches b ${where} LIMIT 1
    `, params);
    if (!batchRes.rowCount) return null;
    const batch = batchRes.rows[0] as BatchRowShape;

    const txParams: any[] = [batch.batch_id];
    const txWhere = "WHERE batch_id = ?";
    const txRes = await db.query(`
      SELECT t.id, t.merchant_id, t.terminal_id, t.batch_id, t.local_txn_id,
             t.stan, t.amount_minor, t.currency, t.pan_masked, t.txn_type,
             t.auth_mode, t.entry_mode, t.card_brand, t.reader_source,
             t.cvm_result, t.pin_verified, t.status, t.auth_code,
             t.rrn, t.txn_timestamp, t.created_at
      FROM pos2013_transactions t ${txWhere}
      ORDER BY t.created_at ASC
    `, txParams);

    const txns = txRes.rows as TxnRowShape[];
    const txnCount = txns.length;
    const ghostCount = txns.filter(t =>
      String(t.auth_code || "").trim() === "0000" ||
      /^\*+$/.test(String(t.pan_masked || "").replace(/\s/g, ""))
    ).length;
    const totalAmountMinor = txns.reduce((s, t) => s + (Number(t.amount_minor) || 0), 0);

    return {
      batch,
      transactions: txns,
      txnCount,
      ghostCount,
      totalAmountMinor,
      amount: (totalAmountMinor / 100).toFixed(2),
    };
  }

  async closeBatch(params: {
    merchantId: string;
    terminalId?: string;
    batchId?: string;
    includeGhost?: boolean;
    maxTxns?: number;
    minAmountMinor?: number;
    force?: boolean;
  }) {
    const { merchantId, terminalId, includeGhost = false, force = false } = params;
    const now = new Date().toISOString();
    const stamp = () => new Date().toISOString();
    const protocolEvents: { code: ProtocolCode; at: string; ref?: string; message?: string }[] = [];

    if (params.batchId) {
      const existing = await this.getBatchDetails(params.batchId, merchantId);
      if (!existing) throw new Error("Batch not found");
      const batch = existing.batch;
      protocolEvents.push({ code: P2013.BATCH_CLOSE_STARTED, at: stamp(), ref: batch.batch_id });
      const secret = await this.resolveSecret(merchantId, existing.batch.terminal_id);
      const signatureNonce = batch.nonce || crypto.randomBytes(12).toString("hex");
      const signed = this.generateHmacSignature(
        batch.protocol_version || "201.3",
        merchantId, batch.terminal_id, batch.batch_id,
        now, signatureNonce, existing.txnCount, secret
      );
      const finalSettlement = batch.settlement_code || String(Math.floor(100000 + Math.random() * 900000));
      await db.query(
        `UPDATE pos2013_batches
            SET status = 'CLOSED',
                signature = ?,
                nonce = ?,
                settlement_code = COALESCE(settlement_code, ?),
                processed_at = COALESCE(processed_at, ?),
                updated_at = ?
          WHERE batch_id = ? AND merchant_id = ? AND terminal_id = ?`,
        [
          signed, signatureNonce,
          finalSettlement,
          batch.processed_at || now,
          now, batch.batch_id, merchantId, batch.terminal_id
        ]
      );
      protocolEvents.push({ code: P2013.BATCH_CLOSE_SUCCESS, at: stamp(), ref: batch.batch_id, message: `settlement=${finalSettlement}` });
      console.log(`[P2013 | ${P2013.BATCH_CLOSE_SUCCESS}] closeBatch explicit bid=${batch.batch_id} txns=${existing.txnCount}`);
      const details = await this.getBatchDetails(batch.batch_id, merchantId);
      return { ...details!, protocolLastCode: P2013.BATCH_CLOSE_SUCCESS, protocolLastMeaning: explain(P2013.BATCH_CLOSE_SUCCESS), protocolEvents };
    }

    protocolEvents.push({ code: P2013.BATCH_CLOSE_STARTED, at: stamp(), message: `closing orphans for merchant=${merchantId.slice(0,8)}` });
    let fromClause = `FROM pos2013_transactions WHERE merchant_id = ? AND (batch_id IS NULL OR batch_id = '')`;
    const queryParams: any[] = [merchantId];
    if (terminalId) { fromClause += ` AND terminal_id = ?`; queryParams.push(terminalId); }
    if (!includeGhost) {
      fromClause += ` AND COALESCE(auth_code,'') <> '0000'`;
    }
    const countRes = await db.query(`SELECT COUNT(*) as cnt ${fromClause}`, queryParams);
    const cnt = Number(countRes.rows[0]?.cnt || 0);
    if (cnt === 0) throw new Error("No unbatched transactions available");
    const minCount = 1;
    const minAmt = params.minAmountMinor ?? 0;
    const amtRes = await db.query(`SELECT COALESCE(SUM(amount_minor),0) as s ${fromClause}`, queryParams);
    const amt = Number(amtRes.rows[0]?.s || 0);
    if (!force && (cnt < minCount || amt < minAmt)) {
      throw new Error(`Threshold not met: txns=${cnt}/${minCount}, amount=${amt}/${minAmt}`);
    }

    const txRes = await db.query(`SELECT * ${fromClause} ORDER BY created_at ASC`, queryParams);
    const orphanTxns = txRes.rows as TxnRowShape[];
    const assignedTerminal = terminalId || orphanTxns[0].terminal_id;
    const seqRes = await db.query(
      `SELECT COALESCE(MAX(batch_seq),0) as maxSeq FROM pos2013_batches WHERE merchant_id = ? AND terminal_id = ?`,
      [merchantId, assignedTerminal]
    );
    const batchSeq = Number(seqRes.rows[0]?.maxSeq || 0) + 1;
    const newBatchId = params.batchId || `B${Date.now()}${batchSeq.toString().padStart(4, "0")}`;
    const secret = await this.resolveSecret(merchantId, assignedTerminal);
    const nonce = crypto.randomBytes(12).toString("hex");
    const sig = this.generateHmacSignature("201.3", merchantId, assignedTerminal, newBatchId, now, nonce, orphanTxns.length, secret);
    const settlementCode = String(Math.floor(100000 + Math.random() * 900000));
    const batchRowId = uuidv4();
    const totalAmountMinor = orphanTxns.reduce((s, t) => s + (Number(t.amount_minor) || 0), 0);

    await db.query(`
      INSERT INTO pos2013_batches
        (id, batch_id, merchant_id, terminal_id, protocol_version, status,
         settlement_code, txn_count, total_amount_minor, signature, nonce,
         batch_seq, created_at, updated_at, processed_at)
      VALUES (?, ?, ?, ?, '201.3', 'CLOSED', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [batchRowId, newBatchId, merchantId, assignedTerminal, settlementCode, orphanTxns.length, totalAmountMinor, sig, nonce, batchSeq, now, now, now]);

    await db.query(
      `UPDATE pos2013_transactions SET batch_id = ?, status = 'CLOSED', updated_at = CURRENT_TIMESTAMP WHERE id IN (${orphanTxns.map(() => "?").join(",")})`,
      [newBatchId, ...orphanTxns.map(t => t.id)]
    );
    protocolEvents.push({ code: P2013.BATCH_CLOSE_SUCCESS, at: stamp(), ref: newBatchId, message: `txns=${orphanTxns.length} settlement=${settlementCode}` });
    console.log(`[P2013 | ${P2013.BATCH_CLOSE_SUCCESS}] closeBatch new bid=${newBatchId} orphans=${orphanTxns.length}`);
    const details = await this.getBatchDetails(newBatchId, merchantId);
    return { ...details!, protocolLastCode: P2013.BATCH_CLOSE_SUCCESS, protocolLastMeaning: explain(P2013.BATCH_CLOSE_SUCCESS), protocolEvents };
  }

  async exportBatch(batchId: string, format: ExportFormat, opts: Partial<ExportOpts> & { merchantId?: string; }) {
    const details = await this.getBatchDetails(batchId, opts.merchantId);
    if (!details) throw new Error("Batch not found");
    const { batch, transactions } = details;
    const secret = opts.secretKey || await this.resolveSecret(batch.merchant_id, batch.terminal_id);
    const settings = await settingsService.getSettings(batch.merchant_id);
    const ext = settings.extended_settings ? (settings.extended_settings as any) : {};
    const banking = ext.banking || {};
    const business = ext.business || {};

    let defaultBank: any = null;
    try {
      const bRes = await db.query(`
        SELECT * FROM bank_accounts
         WHERE merchant_id = ? AND (is_default = 1 OR verified = 1)
         ORDER BY is_default DESC, verified DESC, created_at DESC
         LIMIT 1
      `, [batch.merchant_id]);
      if (bRes.rowCount) defaultBank = bRes.rows[0];
    } catch (_e) { defaultBank = null; }

    let bizInfo: any = null;
    try {
      const biRes = await db.query(`SELECT * FROM merchant_business_info WHERE merchant_id = ? LIMIT 1`, [batch.merchant_id]);
      if (biRes.rowCount) bizInfo = biRes.rows[0];
    } catch (_e) { bizInfo = null; }

    const routingNumber =
      banking.routingNumber ||
      banking.routing_number ||
      defaultBank?.routing_number ||
      "";
    const accountNumber =
      banking.accountNumber ||
      banking.account_number ||
      defaultBank?.account_number ||
      "";
    const iban =
      banking.iban ||
      defaultBank?.iban ||
      "";
    const swiftBic =
      banking.bic_swift ||
      banking.swift_code ||
      defaultBank?.swift_code ||
      defaultBank?.bic_swift ||
      "";
    const accountHolder =
      banking.account_holder ||
      banking.accountHolder ||
      defaultBank?.account_holder ||
      "";
    const bankName =
      banking.bank_name ||
      banking.bankName ||
      defaultBank?.bank_name ||
      "";
    const accountCurrency =
      banking.currency ||
      defaultBank?.currency ||
      "";

    const addressCountryCode =
      (bizInfo?.business_country || business.business_country || defaultBank?.country || "")
        .trim().toUpperCase();

    const addressCity =
      bizInfo?.business_city || business.business_city || "";

    const addressFirstLine =
      bizInfo?.business_address || business.business_address || defaultBank?.bank_branch || "";

    const addressState =
      bizInfo?.business_state || business.business_state ||
      (addressCountryCode === "AE" ? (addressCity && /dubai|DXB/i.test(addressCity) ? "DU" : "AB") : "");

    const transferPurpose =
      banking.transferPurpose || banking.transfer_purpose ||
      "BUSINESS_PAYMENT";

    const receiverType: "PRIVATE" | "INSTITUTION" =
      (banking.receiverType || banking.receiver_type === "PRIVATE")
        ? "PRIVATE"
        : "INSTITUTION";

    const companyName =
      ext.display_name ||
      business.businessName ||
      business.business_name ||
      bizInfo?.business_name ||
      settings.merchant_name ||
      batch.merchant_id;

    const merchantName =
      settings.merchant_name ||
      companyName;

    const supportEmail =
      settings.support_email ||
      bizInfo?.business_email ||
      "";

    const supportPhone =
      settings.support_phone ||
      bizInfo?.business_phone ||
      "";

    const result = batchExporter.export(batch as BatchRowShape, transactions as TxnRowShape[], format, {
      includeGhost: opts.includeGhost === true,
      secretKey: secret,
      generatedAt: opts.generatedAt,
      merchant: {
        merchantName,
        companyName,
        supportEmail,
        supportPhone,
        businessCountry: bizInfo?.business_country || business.business_country || "",
        businessAddress: bizInfo?.business_address || business.business_address || "",
        ein: business.taxId || business.ein || bizInfo?.business_reg_no || bizInfo?.tax_id || "",
        routingNumber,
        accountNumber,
        iban,
        swiftBic,
        accountHolder,
        bankName,
        accountCurrency,
        accountType:
          banking.account_type ||
          banking.accountType ||
          defaultBank?.account_type ||
          "",
        settlementCode: batch.settlement_code || undefined,
      },
    });

    await db.query(`
      UPDATE pos2013_batches
         SET batch_file = ?, status = CASE WHEN status IN ('RECEIVED','PENDING','CLOSED') THEN 'EXPORTED' ELSE status END, updated_at = CURRENT_TIMESTAMP
       WHERE batch_id = ? AND merchant_id = ? AND terminal_id = ?
    `, [
      JSON.stringify({
        format: result.format,
        filename: result.filename,
        contentType: result.contentType,
        byteLength: result.byteLength,
        txnCount: result.txnCount,
        ghostExcluded: result.ghostExcluded,
        totalDebitMinor: result.totalDebitMinor,
        totalCreditMinor: result.totalCreditMinor,
        entryHash10: result.controlEntryHash,
        signature: result.signature,
        canonicalPayload: result.canonicalPayload,
        generatedAt: result.generatedAt,
        meta: {
          default_bank_id: defaultBank?.id || null,
          business_info_used: !!bizInfo,
          banking_source: defaultBank && !banking.accountNumber ? "bank_accounts_table" : "extended_settings",
        },
      }),
      batch.batch_id, batch.merchant_id, batch.terminal_id
    ]);

    return result;
  }

  async markBatchUploaded(params: {
    batchId: string;
    merchantId?: string;
    externalRef?: string;
    processor?: string;
    uploadTimestamp?: string;
    status?: string;
  }) {
    const { batchId, merchantId, externalRef, processor, status } = params;
    const now = params.uploadTimestamp || new Date().toISOString();
    const p: any[] = [now, now];
    let where = "WHERE batch_id = ?";
    p.push(batchId);
    if (merchantId) { where += " AND merchant_id = ?"; p.push(merchantId); }
    const setClauses: string[] = ["upload_timestamp = ?", "updated_at = ?"];
    if (externalRef !== undefined) { setClauses.push("settlement_code = COALESCE(NULLIF(settlement_code,''), ?)"); p.push(externalRef); }
    if (processor !== undefined) { /* processor tracked in meta via JSON merge */ }
    const newStatus = status || "UPLOADED";
    setClauses.push("status = ?"); p.push(newStatus);
    const q = `UPDATE pos2013_batches SET ${setClauses.join(", ")} ${where}`;
    const r = await db.query(q, p);
    return { affected: Number(r.rowCount || 0), batchId, merchantId, externalRef, status: newStatus };
  }

  async autoCloseCandidates(merchantId: string, thresholds: {
    terminalId?: string;
    maxAgeHours?: number;
    minTxnCount?: number;
    minAmountMinor?: number;
  }) {
    const { terminalId, maxAgeHours = 24, minTxnCount = 50, minAmountMinor = 100000 } = thresholds;
    let where = `WHERE merchant_id = ? AND (batch_id IS NULL OR batch_id = '') AND COALESCE(auth_code,'') <> '0000'`;
    const p: any[] = [merchantId];
    if (terminalId) { where += ` AND terminal_id = ?`; p.push(terminalId); }

    const ageCutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();
    const groupRes = await db.query(`
      SELECT terminal_id,
             COUNT(*) as cnt,
             COALESCE(SUM(amount_minor),0) as sumMinor,
             MIN(created_at) as oldest
        FROM pos2013_transactions
       ${where}
       GROUP BY terminal_id
    `, p);

    return groupRes.rows.map((r: any) => {
      const cnt = Number(r.cnt || 0);
      const sumMinor = Number(r.sumMinor || 0);
      const oldest = String(r.oldest || "");
      const trigger: string[] = [];
      if (cnt >= minTxnCount) trigger.push(`count:${cnt}>=${minTxnCount}`);
      if (sumMinor >= minAmountMinor) trigger.push(`amount:${sumMinor}>=${minAmountMinor}`);
      if (oldest && oldest < ageCutoff) trigger.push(`age:${oldest}<${ageCutoff}`);
      return {
        terminalId: r.terminal_id,
        txnCount: cnt,
        totalAmountMinor: sumMinor,
        totalAmount: (sumMinor / 100).toFixed(2),
        oldestTxnAt: oldest,
        thresholdHit: trigger.length > 0,
        triggers: trigger,
      };
    });
  }
}

export const batchesService = new BatchesService();
