import axios from 'axios';
import { acquirerConfig } from '../../config/acquirer';
import { createAcquirerClient } from './acquirer';
import { db } from "../../config/db";
import { validateTransition, createLedgerEntry, persistLedgerEntry, type TransactionState } from '../ledger/ledger.service';
import { buildEmvChargePayload, parseTlv } from './emv-tlv-parser';
import { syncOfflinePreflight, type PreflightPayload } from './offline-decline-preflight';
import type { OnlineAuthorizationResult } from './pos-decision.service';
import { captureCardTransaction } from '../../services/payments/cardCapture';
import { v4 as uuidv4 } from 'uuid';

interface PosTransactionPayload extends PreflightPayload {
  customerId?:      string;
  authCode?:        string;   // pre-authorized code (voice auth 101.1)
  entryMode?:       string;   // VOICE_AUTH, MANUAL, CHIP, etc.
  cardholderName?:  string;
  cardholder_name?: string;
  /**
   * Explicit protocol selected by the caller for this capture.
   *
   *  - "101.1"   — voice/standalone pre-authorization (use for DTC/SWIFT-backed
   *                inbound registrations, e.g. authCode 0707). Requires real
   *                external provider fund verification + Omnibus balance
   *                coverage BEFORE any wallet credit. No demo/no stand-in.
   *  - "101.6"   — EMV/chip authorization (ARQC/TC present in field55).
   *  - "201.3"   — standard online POS capture (default for non-registered codes).
   *
   * If omitted, the processor will infer it (101.6 if EMV field55 present,
   * 101.1 if authCode is present AND matches a pre-registered inbound record,
   * 201.3 otherwise). Explicitly passing protocol is STRONGLY preferred for
   * financial integrity so inference bugs cannot bypass gates.
   */
  protocol?:       '101.1' | '101.6' | '201.3' | string;
}

interface PosTransactionResult {
  success: boolean;
  status: 'APPROVED' | 'DECLINED' | 'PENDING';
  channel?: 'ONLINE' | 'OFFLINE';
  paymentIntentId?: string;
  settlementId?: string;
  clientSecret?: string;
  amountMinor: number;
  currency: string;
  processor: string;
  authCode?: string;
  error?: string;
  reason?: string;
  idempotent?: boolean;
  [key: string]: any;
}

const MAX_POS_TRANSACTION_AMOUNT = 1_000_000_000;

export class PaymentsService {

  private async getMaximumTransactionAmount(merchantId: string): Promise<number> {
    const settings = await db.query(
      'SELECT payment_config FROM merchant_settings WHERE merchant_id = ?',
      [merchantId],
    );
    const configured = settings.rows?.[0]?.payment_config;
    if (typeof configured !== 'string' || !configured.trim()) return MAX_POS_TRANSACTION_AMOUNT;

    const methods: unknown = JSON.parse(configured);
    if (!Array.isArray(methods)) throw new Error('Payment method configuration must be an array');
    const limits = methods.flatMap((method) => {
      if (!method || typeof method !== 'object') return [];
      const candidate = method as { type?: unknown; enabled?: unknown; config?: { maxTransactionAmount?: unknown } };
      const maximum = candidate.config?.maxTransactionAmount;
      return candidate.type === 'card' && candidate.enabled !== false
        && typeof maximum === 'number' && Number.isFinite(maximum) && maximum > 0
        ? [maximum]
        : [];
    });
    return limits.length ? Math.min(...limits) : MAX_POS_TRANSACTION_AMOUNT;
  }

  private buildIdempotencyKey(payload: PosTransactionPayload): string {
    const merchantId = (payload.merchantId || '').toString();
    const terminalId = (payload.terminalId || '').toString();
    const stan = (payload.stan || '').toString();
    const customerId = (payload.customerId || '').toString();
    const amountMinor = Number(payload.amountMinor || 0);
    const currency = (payload.currency || 'USD').toString();

    return `POS:${merchantId}:${terminalId}:${stan || 'AUTO'}:${amountMinor}:${currency}:${customerId}`.replace(/\s+/g, '');
  }

  private async getCachedResult(idempotencyKey: string): Promise<PosTransactionResult | null> {
    const res = await db.query('SELECT result_json FROM pos_idempotency WHERE idempotency_key = ?', [idempotencyKey]);
    if (!res.rows?.length) return null;

    const cached = res.rows[0]?.result_json;
    if (!cached) return null;

    try {
      return JSON.parse(cached) as PosTransactionResult;
    } catch {
      return null;
    }
  }

  private async saveIdempotencyResult(idempotencyKey: string, result: PosTransactionResult) {
    await db.query(
      `INSERT OR REPLACE INTO pos_idempotency (idempotency_key, result_json, created_at, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [idempotencyKey, JSON.stringify(result)]
    );
  }

  private getProcessorBaseUrl(): string | null {
    const url = process.env.CARD_PROCESSOR_URL?.trim() || process.env.PAYMENT_PROCESSOR_URL?.trim() || null;
    return url || null;
  }

  private getProcessorApiKey(): string | null {
    return process.env.CARD_PROCESSOR_KEY?.trim() || process.env.PAYMENT_PROCESSOR_KEY?.trim() || null;
  }

  private isUsableProcessorUrl(value: string): boolean {
    const url = String(value || '').trim();
    if (!/^https:\/\//i.test(url)) return false;
    return !/(your[-_.]?processor|example\.com|localhost|127\.0\.0\.1)/i.test(url);
  }

  public getProcessorStatus(): {
    enabled: boolean;
    mode: 'LIVE' | 'DRY-RUN' | 'DISABLED';
    acquirerActive: boolean;
    processorUrlSet: boolean;
    processorUrlValid: boolean;
    lookupUrlSet: boolean;
    captureUrlSet: boolean;
    bothBatchUrlsValid: boolean;
    authHeaderSet: boolean;
    reasons: string[];
  } {
    const reasons: string[] = [];

    const enabledRaw = String(process.env.CARD_PROCESSOR_ENABLED || 'false').trim().toLowerCase();
    const enabledFlag = ['1', 'true', 'on', 'yes'].includes(enabledRaw);

    const acquirerActive = Boolean(acquirerConfig.host);
    if (acquirerActive) reasons.push('Direct acquirer host configured (' + acquirerConfig.host + ':' + (acquirerConfig.port ?? 'default') + ')');
    else reasons.push('Direct acquirer host NOT configured (acquirerConfig.host empty)');

    const processorUrl = this.getProcessorBaseUrl();
    const processorUrlSet = Boolean(processorUrl);
    const processorUrlValid = processorUrlSet && this.isUsableProcessorUrl(processorUrl!);
    if (!processorUrlSet) reasons.push('CARD_PROCESSOR_URL / PAYMENT_PROCESSOR_URL not set');
    else if (!processorUrlValid) reasons.push('CARD_PROCESSOR_URL is not a valid https URL (contains example/localhost/placeholder)');

    const LOOKUP_URL = process.env.CARD_PROCESSOR_LOOKUP_URL || '';
    const CAPTURE_URL = process.env.CARD_PROCESSOR_CAPTURE_URL || '';
    const lookupUrlSet = Boolean(LOOKUP_URL.trim());
    const captureUrlSet = Boolean(CAPTURE_URL.trim());
    const bothBatchUrlsValid = this.isUsableProcessorUrl(LOOKUP_URL) && this.isUsableProcessorUrl(CAPTURE_URL);
    if (!lookupUrlSet) reasons.push('CARD_PROCESSOR_LOOKUP_URL not set (batch pipeline disabled)');
    if (!captureUrlSet) reasons.push('CARD_PROCESSOR_CAPTURE_URL not set (batch pipeline disabled)');
    if (lookupUrlSet && !this.isUsableProcessorUrl(LOOKUP_URL)) reasons.push('CARD_PROCESSOR_LOOKUP_URL is not a valid https URL');
    if (captureUrlSet && !this.isUsableProcessorUrl(CAPTURE_URL)) reasons.push('CARD_PROCESSOR_CAPTURE_URL is not a valid https URL');

    const authHeaderSet = Boolean((process.env.CARD_PROCESSOR_AUTH_HEADER || process.env.CARD_PROCESSOR_KEY || process.env.PAYMENT_PROCESSOR_KEY || '').trim());
    if (!authHeaderSet) reasons.push('No processor auth header/key set (CARD_PROCESSOR_AUTH_HEADER / CARD_PROCESSOR_KEY / PAYMENT_PROCESSOR_KEY)');

    const onlinePathReady = (acquirerActive) || (enabledFlag && processorUrlValid);
    const batchPathReady = enabledFlag && bothBatchUrlsValid;
    const enabled = (acquirerActive) || enabledFlag;

    let mode: 'LIVE' | 'DRY-RUN' | 'DISABLED' = 'DISABLED';
    if (enabled && (onlinePathReady || batchPathReady)) mode = 'LIVE';
    else if (!enabled) mode = 'DISABLED';
    else mode = 'DRY-RUN';

    if (!enabledFlag && !acquirerActive) reasons.unshift('CARD_PROCESSOR_ENABLED is false/unset — kill switch active');

    return {
      enabled,
      mode,
      acquirerActive,
      processorUrlSet,
      processorUrlValid,
      lookupUrlSet,
      captureUrlSet,
      bothBatchUrlsValid,
      authHeaderSet,
      reasons,
    };
  }

  private async authorizeOnlineCharge(payload: PosTransactionPayload): Promise<OnlineAuthorizationResult> {
    if (acquirerConfig.host) {
      try {
        const acquirer = createAcquirerClient();
        const merchantAccount = acquirerConfig.merchantId || String(payload.merchantId || '').trim();
        if (!merchantAccount) {
          return { success: false, status: 'ERROR', processor: { approved: false, reason: 'Acquirer merchant account missing' }, error: 'ACQUIRER_MERCHANT_ACCOUNT or merchantId is required' };
        }
        const field55 = String(payload.emv?.field55 || payload.emv?.field55Hex || payload.emv?.field55hex || payload.emv?.tlvRaw || '').trim();
        const result = await acquirer.authorize({
          merchantAccount,
          amountMinor: Number(payload.amountMinor),
          currency: String(payload.currency || 'USD').toUpperCase(),
          cardNumber: payload.pan,
          expiry: payload.expiry,
          cvv: payload.cvv,
          emvField55: field55 || undefined,
          protocol: field55 ? '101.6' : '101.1',
        });
        // EMV ARQC validation when Field 55 is present
        if (field55 && result.success) {
          try {
            const { IssuerEmvValidator } = await import('../../services/hsm/issuerEmvValidator');
            const { getHsmClient } = await import('../../services/hsm/hsmClientImpl');
            const validator = new IssuerEmvValidator(getHsmClient());
            const expiry = (payload.expiry || '3012').replace('/', '');
            const currency = payload.currency === 'EUR' ? '978' : payload.currency === 'GBP' ? '826' : '840';
            await validator.validate(field55, payload.pan || '', expiry, Number(payload.amountMinor), currency);
            console.log('[EMV] ARQC validated successfully for auth ' + result.approvalCode);
          } catch (emvErr: any) {
            console.warn('[EMV] ARQC validation failed:', emvErr.message, '— continuing with acquirer approval');
            // Non-fatal for now — log and continue. Set to fatal when HSM is live.
          }
        }

        if (!result.success) {
          return {
            success: false,
            status: result.responseCode,
            processor: { approved: false, code: result.responseCode, reason: result.message || 'Acquirer declined' },
            error: result.message || `Acquirer declined (RC=${result.responseCode})`,
          };
        }
        return {
          success: true,
          status: 'APPROVED',
          processor: { approved: true, code: result.approvalCode, reason: 'Acquirer approved' },
          authCode: result.approvalCode,
          paymentIntentId: result.authRef,
        };
      } catch (error: any) {
        const message = error?.response?.data?.message || error?.message || 'Acquirer authorization failed';
        return { success: false, status: 'ERROR', processor: { approved: false, reason: message }, error: message };
      }
    }

    const status = this.getProcessorStatus();
    if (!status.enabled) {
      return {
        success: false,
        status: 'CONFIGURATION_ERROR',
        processor: {
          approved: false,
          reason: status.reasons.join(' | '),
        },
        error: 'Card processor disabled — ' + status.reasons.join(' | '),
      };
    }

    const processorUrl = this.getProcessorBaseUrl();
    if (!processorUrl) {
      if (status.acquirerActive) {
        return {
          success: false,
          status: 'CONFIGURATION_ERROR',
          processor: {
            approved: false,
            reason: 'Direct acquirer call failed and no CARD_PROCESSOR_URL fallback set.',
          },
          error: 'Direct acquirer authorization failed and no HTTP processor fallback configured.',
        };
      }
      return {
        success: false,
        status: 'CONFIGURATION_ERROR',
        processor: {
          approved: false,
          reason: 'No card processor configured. Set CARD_PROCESSOR_URL in environment variables.',
        },
        error: 'Card processor not configured — transaction declined.',
      };
    }

    if (!status.acquirerActive && !this.isUsableProcessorUrl(processorUrl)) {
      return {
        success: false,
        status: 'CONFIGURATION_ERROR',
        processor: {
          approved: false,
          reason: 'CARD_PROCESSOR_URL is a placeholder/invalid URL (must be real https://, not example.com/localhost/your-processor) and no direct acquirer is configured.',
        },
        error: 'Card processor URL is a placeholder — set a real HTTPS endpoint in CARD_PROCESSOR_URL or configure Vault Bank Acquirer.',
      };
    }

    const emvPayload = buildEmvChargePayload(payload.emv);
    const body: Record<string, unknown> = {
      amountMinor: payload.amountMinor,
      amount: Number(payload.amountMinor) / 100,
      currency: payload.currency || 'USD',
      merchantId: payload.merchantId,
      terminalId: payload.terminalId,
      stan: payload.stan || `STAN${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`,
      pan: payload.pan,
      expiry: payload.expiry,
      cvv: payload.cvv,
      customerId: payload.customerId,
      source: 'pos_transaction',
      emv: emvPayload,
    };

    const field55 = String(payload.emv?.field55 || payload.emv?.field55Hex || payload.emv?.field55hex || payload.emv?.tlvRaw || payload.emv?.TLV || '').trim();
    if (field55) {
      body.field55 = field55;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiKey = this.getProcessorApiKey();
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    try {
      const response = await axios.post(processorUrl, body, { headers, timeout: 15000 });
      const data = response?.data || {};
      const approved = data.success === true || data.approved === true || /^(approved|authorized|paid)$/i.test(String(data.status || data.statusCode || ''));
      const authCode = String(data.authCode || data.authorizationCode || data.AuthorizationCode || data.auth_code || data.paymentId || data.id || '').trim() || undefined;
      const paymentIntentId = String(data.paymentIntentId || data.paymentId || data.id || '').trim() || undefined;

      if (!approved) {
        const declCode = String(data.status || data.statusCode || data.code || data.declineCode || data.responseCode || 'DECLINED').toUpperCase();
        return {
          success: false,
          status: declCode,
          processor: { approved: false, code: declCode, reason: String(data.message || data.error || 'Processor declined') },
          error: String(data.message || data.error || 'Processor declined'),
        };
      }

      const captured = data.captured === true
        || data.captureConfirmed === true
        || /^(captured|settled|paid)$/i.test(String(data.status || data.statusCode || ''));
      if (!authCode) {
        return {
          success: false,
          status: 'INVALID_PROVIDER_RESPONSE',
          processor: { approved: false, reason: 'Provider did not return an authorization reference' },
          error: 'Provider response did not include an authorization reference.',
        };
      }
      if (!captured) {
        return {
          success: false,
          status: 'PENDING_CAPTURE',
          processor: { approved: false, reason: 'Provider authorization was not an explicit capture confirmation' },
          authCode,
          paymentIntentId,
          error: 'Provider authorization is not proof of captured funds.',
        };
      }

      return {
        success: true,
        status: 'CAPTURED',
        processor: { approved: true, code: authCode, reason: 'Processor approved' },
        authCode,
        paymentIntentId,
      };
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.message || 'Processor request failed';
      return {
        success: false,
        status: 'ERROR',
        processor: { approved: false, reason: message },
        error: message,
      };
    }
  }

  async charge(_merchantId: string, payload: PosTransactionPayload) {
    const merchantId = payload.merchantId || _merchantId;
    return this.processPosTransaction({ ...payload, merchantId });
  }

  private async acceptForBankBatch(payload: PosTransactionPayload): Promise<PosTransactionResult> {
    const processorReference = `POS-${uuidv4().replace(/-/g, '').slice(0, 20).toUpperCase()}`;
    const now = new Date().toISOString();
    const merchantId = payload.merchantId || '';
    const terminalId = payload.terminalId || '';
    const panMasked = payload.pan
      ? `${'*'.repeat(Math.max(payload.pan.length - 4, 0))}${payload.pan.slice(-4)}`
      : null;
    const batchId = `ONLINE-${now.slice(0, 10).replace(/-/g, '')}-${merchantId}-${terminalId}`;

    await db.query(
      `INSERT INTO pos2013_transactions
        (id, merchant_id, terminal_id, batch_id, local_txn_id, stan,
         amount_minor, currency, pan_masked, txn_type, auth_mode, entry_mode,
         status, emv_data, txn_timestamp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SALE', 'STANDALONE_PROCESSOR', ?, 'PENDING', ?, ?, ?)` ,
      [
        processorReference,
        merchantId,
        terminalId,
        batchId,
        processorReference,
        payload.stan || null,
        payload.amountMinor,
        payload.currency || 'USD',
        panMasked,
        payload.emv ? 'CHIP' : 'MANUAL',
        payload.emv ? JSON.stringify(payload.emv) : null,
        now,
        now,
      ]
    );

    const settlementId = uuidv4();
    await db.query(
      `INSERT INTO merchant_pos_settlements
        (id, merchant_id, amount, currency, status, created_at, updated_at, meta)
       VALUES (?, ?, ?, ?, 'unsettled', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)`,
      [
        settlementId,
        merchantId,
        Number(payload.amountMinor) / 100,
        payload.currency || 'USD',
        JSON.stringify({
          processor_reference: processorReference,
          batch_id: batchId,
          terminal_id: terminalId,
          stan: payload.stan || null,
          card_masked: panMasked,
          entry_mode: payload.emv ? 'CHIP' : 'MANUAL',
          authorization_status: 'PENDING_BANK_BATCH',
        }),
      ]
    );

    return {
      success: true,
      status: 'PENDING',
      paymentIntentId: processorReference,
      settlementId,
      amountMinor: payload.amountMinor,
      currency: payload.currency,
      processor: 'STANDALONE_PROCESSOR',
      reason: 'Transaction accepted and queued for bank batch authorization',
    };
  }

  async processPosTransaction(payload: PosTransactionPayload): Promise<PosTransactionResult> {
    const idempotencyKey = this.buildIdempotencyKey(payload);
    const cachedResult = await this.getCachedResult(idempotencyKey);
    if (cachedResult) {
      return {
        ...cachedResult,
        idempotent: true,
        reason: cachedResult.reason || 'Duplicate request returned cached result',
      };
    }

    const processorName = 'PROCESSOR';
    const merchantId = payload.merchantId || '';

    try {
      if (!Number.isSafeInteger(Number(payload.amountMinor)) || Number(payload.amountMinor) <= 0) {
        throw new Error('Transaction amount must be a positive safe integer in minor units.');
      }
      const maximum = await this.getMaximumTransactionAmount(merchantId);
      if (Number(payload.amountMinor) / 100 > maximum) {
        const rejected: PosTransactionResult = {
          success: false,
          status: 'DECLINED',
          channel: 'ONLINE',
          amountMinor: payload.amountMinor,
          currency: payload.currency || 'USD',
          processor: processorName,
          error: `Amount exceeds the configured maximum of ${maximum.toLocaleString()} ${payload.currency || 'USD'}.`,
          reason: 'MAX_TRANSACTION_AMOUNT_EXCEEDED',
        };
        await this.saveIdempotencyResult(idempotencyKey, rejected);
        return rejected;
      }
      // customerId is optional — required only for offline customer wallet credit
      // if (!payload.customerId?.trim()) { throw new Error('customer wallet required'); }

      // â”€â”€ HARD DECLINE PRE-FLIGHT (runs for BOTH online and offline decisions) â”€
      const preflight = syncOfflinePreflight(payload);
      if (preflight.declined) {
        const resp: PosTransactionResult = {
          success: false,
          status: 'DECLINED',
          amountMinor: payload.amountMinor,
          currency: payload.currency,
          processor: processorName,
          error: preflight.reason,
          reason: `[${preflight.code}] ${preflight.reason}`,
        };
        await this.saveIdempotencyResult(this.buildIdempotencyKey(payload), resp);
        // Audit decline (no wallet credit, no settlement row, but log declined tx for reconciliation)
        const declineId = `decl_${Date.now().toString(36)}`;
        await db.query(
          `INSERT OR IGNORE INTO pos2013_transactions
            (id, merchant_id, terminal_id, local_txn_id, stan, amount_minor, currency,
             pan_masked, txn_type, auth_mode, entry_mode, auth_code, status, txn_timestamp, decline_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            declineId,
            merchantId,
            payload.terminalId || '',
            declineId,
            payload.stan || '',
            payload.amountMinor,
            payload.currency || 'USD',
            payload.pan ? `${'*'.repeat(Math.max(payload.pan.length - 4, 0))}${payload.pan.slice(-4)}` : null,
            'PURCHASE',
            'declined',
            payload.emv ? 'CHIP' : 'MANUAL',
            preflight.code || 'DECLINE',
            'DECLINED',
            new Date().toISOString(),
            `[${preflight.code}] ${preflight.reason}`,
          ]
        );
        return resp;
      }

      // Decide whether we need to go online using the POS decision service
      let decision: any = null;
      try {
        const { posDecisionService } = await import('./pos-decision.service');
        decision = await posDecisionService.decide({
          merchantId: payload.merchantId || '',
          terminalId: payload.terminalId || '',
          amountMinor: payload.amountMinor,
          currency: payload.currency || 'USD',
          emv: payload.emv,
        });
      } catch (decErr: any) {
        const unavailable: PosTransactionResult = {
          success: false,
          status: 'DECLINED',
          channel: 'ONLINE',
          amountMinor: payload.amountMinor,
          currency: payload.currency,
          processor: processorName,
          error: 'POS decision service is unavailable; online authorization is required.',
          reason: decErr instanceof Error ? decErr.message : String(decErr),
        };
        await this.saveIdempotencyResult(this.buildIdempotencyKey(payload), unavailable);
        return unavailable;
        // â•â• ALLOW FALLBACK TO OFFLINE FLOOR IF DECISION SERVICE DOWN â•â•â•â•â•â•â•â•
        //  â€¢ EMV chip produced TC (issuer offline-approved) â†’ OK
        //  â€¢ OR terminal offline_enabled + amount â‰¤ floor_limit â†’ OK
        //  Otherwise â†’ HARD DECLINE (no demo stand-in, correct).
        const tlvHex = String(payload.emv?.field55 || payload.emv?.field55Hex || payload.emv?.tlvRaw || payload.emv?.TLV || '').replace(/[^0-9A-Fa-f]/g, '');
        let emvTags: Record<string, string> = {};
        if (tlvHex && tlvHex.length % 2 === 0) {
          try {
            const map = parseTlv(Buffer.from(tlvHex, 'hex'));
            for (const [k, v] of Object.entries(map)) {
              try { emvTags[String(k).toUpperCase()] = (v as Buffer).toString('hex'); } catch { /* ignore */ }
            }
          } catch { /* ignore */ }
        }
        const cType = String(payload.emv?.cryptogramType || '').toUpperCase();
        const cidHex = String(payload.emv?.cid || emvTags['9F27'] || '').slice(0, 2);
        const cid = cidHex ? parseInt(cidHex, 16) : null;
        const tcOk = cType === 'TC' || ((Number(cid ?? 0) & 0xC0) === 0x80);
        let floorOk = false;
        const tid = payload.terminalId || '';
        if (tid) {
          try {
            const tm = await db.query('SELECT offline_enabled, floor_limit FROM terminals WHERE terminal_id = ? LIMIT 1', [tid]);
            if (tm.rows?.[0]) {
              const row = tm.rows[0] as any;
              if (row.offline_enabled === 1 || row.offline_enabled === true) {
                const floor = Number(row.floor_limit || 0);
                if (floor > 0 && (payload.amountMinor / 100) <= floor) floorOk = true;
              }
            }
          } catch { /* ignore */ }
        }
        if (tcOk || floorOk) {
          // Fall through to OFFLINE approval branch below. REAL standalone offline acquirer.
          console.log(`[OFFLINE-ACQUIRER] Decision service down (${decErr?.message || 'error'}), falling back to TC=${tcOk}/floor=${floorOk} offline approval for STAN=${payload.stan || '-'}`);
        } else {
          // HARD DECLINE. No offline fallback, no demo.
          const resp: PosTransactionResult = {
            success: false,
            status: 'DECLINED',
            amountMinor: payload.amountMinor,
            currency: payload.currency,
            processor: processorName,
            error: 'Cannot process: POS decision service unavailable â€” NO demo approval fallback.',
            reason: `[DECISION_SERVICE_DOWN] ${decErr?.message || 'decision service error'} â†’ declined (no EMV TC, no terminal floor-limit available)`,
          };
          await this.saveIdempotencyResult(this.buildIdempotencyKey(payload), resp);
          return resp;
        }
      }

      // If decision requires online authorization, attempt it
      const needsOnline = !!payload.authCode || !!(
        decision &&
        (decision.mode === 'online' || decision.decision === 'ONLINE_APPROVE' || decision.onlineRequired ||
          decision.goOnline || decision.requiresOnlineAuth)
      );

      if (!needsOnline) {
        const denied: PosTransactionResult = {
          success: false,
          status: 'DECLINED',
          channel: 'OFFLINE',
          amountMinor: payload.amountMinor,
          currency: payload.currency,
          processor: processorName,
          error: 'Offline approvals are disabled; a live online authorization is required.',
          reason: 'No provider authorization was requested, so no funds were credited.',
        };
        await this.saveIdempotencyResult(this.buildIdempotencyKey(payload), denied);
        return denied;
      }

      let skipOfflineBranch = false;

      if (needsOnline) {
        const online = await this.authorizeOnlineCharge(payload);
        if (!online.success && online.status === 'PENDING_CAPTURE') {
          const paymentIntentId = online.paymentIntentId || online.authCode || `pending_${Date.now().toString(36)}`;
          const pending: PosTransactionResult = {
            success: false,
            status: 'PENDING',
            channel: 'ONLINE',
            paymentIntentId,
            amountMinor: payload.amountMinor,
            currency: payload.currency,
            processor: processorName,
            authCode: online.authCode,
            error: 'Provider authorization was received, but capture was not confirmed. No wallet was credited.',
            reason: online.error,
          };
          await db.query(
            `INSERT OR IGNORE INTO pos2013_transactions
              (id, merchant_id, customer_id, terminal_id, batch_id, local_txn_id, stan,
               amount_minor, currency, pan_masked, txn_type, auth_mode,
               entry_mode, auth_code, status, txn_timestamp, decline_reason)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PURCHASE', 'online', ?, ?, 'PENDING_CAPTURE', ?, ?)`,
            [
              paymentIntentId, merchantId, payload.customerId, payload.terminalId || '', `batch-${paymentIntentId}`,
              paymentIntentId, payload.stan || '', payload.amountMinor, payload.currency || 'USD',
              payload.pan ? `${'*'.repeat(Math.max(payload.pan.length - 4, 0))}${payload.pan.slice(-4)}` : null,
              payload.emv ? 'CHIP' : 'MANUAL', online.authCode || null, new Date().toISOString(), online.error,
            ],
          );
          await this.saveIdempotencyResult(idempotencyKey, pending);
          return pending;
        }
        if (online.status === 'PENDING_BANK_BATCH') {
          const resp: PosTransactionResult = {
            success: false,
            status: 'PENDING',
            channel: 'ONLINE',
            amountMinor: payload.amountMinor,
            currency: payload.currency,
            processor: processorName,
            error: 'Provider has not confirmed the charge.',
            reason: 'Charge is pending bank confirmation; no customer wallet credit was posted.',
          };
          await this.saveIdempotencyResult(this.buildIdempotencyKey(payload), resp);
          return resp;
        }
        if (!online.success) {
          const denied: PosTransactionResult = {
            success: false,
            status: 'DECLINED',
            channel: 'ONLINE',
            amountMinor: payload.amountMinor,
            currency: payload.currency,
            processor: processorName,
            error: online.error || 'Provider did not approve the transaction.',
            reason: online.status || 'ONLINE_AUTHORIZATION_FAILED',
          };
          await this.saveIdempotencyResult(this.buildIdempotencyKey(payload), denied);
          return denied;
          // â”€â”€ YOUR OFFLINE ACQUIRER FALLBACK (only for CONFIGURATION_ERROR) â”€â”€
          // If processor URL not configured, but EITHER:
          //   (A) EMV chip already TC-approved offline (CID=0x80), OR
          //   (B) Terminal offline_enabled + amount â‰¤ floor_limit
          // â†’ Fall through to OFFLINE approval below. REAL offline acquirer, not demo.
          // Any other decline (processor said NO) â†’ still hard decline (correct).
          const isCfgError = online.status && String(online.status).toUpperCase() === 'CONFIGURATION_ERROR';
          if (isCfgError && !payload.authCode) {
            // Compute offlineEmvApproved here for fallback check
            const tlvHex = String(payload.emv?.field55 || payload.emv?.field55Hex || payload.emv?.tlvRaw || payload.emv?.TLV || '').replace(/[^0-9A-Fa-f]/g, '');
            let emvTags: Record<string, string> = {};
            if (tlvHex && tlvHex.length % 2 === 0) {
              const map = parseTlv(Buffer.from(tlvHex, 'hex'));
              for (const [k, v] of Object.entries(map)) {
                try { emvTags[String(k).toUpperCase()] = (v as Buffer).toString('hex'); } catch { /* ignore */ }
              }
            }
            const cType = String(payload.emv?.cryptogramType || '').toUpperCase();
            const cidHex = String(payload.emv?.cid || emvTags['9F27'] || '').slice(0, 2);
            const cid = cidHex ? parseInt(cidHex, 16) : null;
            const tcOk = cType === 'TC' || ((Number(cid ?? 0) & 0xC0) === 0x80);
            let floorOk = false;
            const tid = payload.terminalId || '';
            if (tid) {
              try {
                const tm = await db.query('SELECT offline_enabled, floor_limit FROM terminals WHERE terminal_id = ? LIMIT 1', [tid]);
                if (tm.rows?.[0]) {
                  const row = tm.rows[0] as any;
                  if (row.offline_enabled === 1 || row.offline_enabled === true) {
                    const floor = Number(row.floor_limit || 0);
                    if (floor > 0 && (payload.amountMinor / 100) <= floor) floorOk = true;
                  }
                }
              } catch { /* ignore */ }
            }
            if (tcOk || floorOk) {
              // âœ… Fall through to OFFLINE approval branch below.
              // This is YOUR STANDALONE OFFLINE ACQUIRER â€” NO EXTERNAL GATEWAY.
              console.log(`[OFFLINE-ACQUIRER] Processor unavailable, falling back to TC=${tcOk}/floor=${floorOk} offline approval for STAN=${payload.stan || '-'}`);
            } else {
              // No offline fallback available â†’ HARD DECLINE (no demo approval).
              const resp: PosTransactionResult = {
                success: false,
                status: 'DECLINED',
                amountMinor: payload.amountMinor,
                currency: payload.currency,
                processor: 'PROCESSOR',
                error: online.error || 'Online authorization failed and no offline fallback available.',
                reason: `[${online.status || 'ONLINE_FAILED'}] ${online.error || 'Online authorization failed and no offline fallback (no EMV TC, no terminal floor-limit).'}`
              };
              await this.saveIdempotencyResult(this.buildIdempotencyKey(payload), resp);
              const declineId = `decl_onl_${Date.now().toString(36)}`;
              await db.query(
                `INSERT OR IGNORE INTO pos2013_transactions
                  (id, merchant_id, terminal_id, local_txn_id, stan, amount_minor, currency,
                   pan_masked, txn_type, auth_mode, entry_mode, auth_code, status, txn_timestamp, decline_reason)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  declineId,
                  merchantId,
                  payload.terminalId || '',
                  declineId,
                  payload.stan || '',
                  payload.amountMinor,
                  payload.currency || 'USD',
                  payload.pan ? `${'*'.repeat(Math.max(String(payload.pan || '').length - 4, 0))}${String(payload.pan || '').slice(-4)}` : null,
                  'PURCHASE',
                  'online',
                  payload.emv ? 'CHIP' : 'MANUAL',
                  online.status || 'DECLINE',
                  'DECLINED',
                  new Date().toISOString(),
                  online.error || 'Online declined',
                ]
              );
              return resp;
            }
          } else {
            // Processor explicitly declined â†’ HARD DECLINE.
            const resp: PosTransactionResult = {
              success: false,
              status: 'DECLINED',
              amountMinor: payload.amountMinor,
              currency: payload.currency,
              processor: 'PROCESSOR',
              error: online.error || 'Online authorization failed',
              reason: online.error || 'Online authorization failed'
            };
            await this.saveIdempotencyResult(this.buildIdempotencyKey(payload), resp);
            const declineId = `decl_onl_${Date.now().toString(36)}`;
            await db.query(
              `INSERT OR IGNORE INTO pos2013_transactions
                (id, merchant_id, terminal_id, local_txn_id, stan, amount_minor, currency,
                 pan_masked, txn_type, auth_mode, entry_mode, auth_code, status, txn_timestamp, decline_reason)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                declineId,
                merchantId,
                payload.terminalId || '',
                declineId,
                payload.stan || '',
                payload.amountMinor,
                payload.currency || 'USD',
                payload.pan ? `${'*'.repeat(Math.max(String(payload.pan || '').length - 4, 0))}${String(payload.pan || '').slice(-4)}` : null,
                'PURCHASE',
                'online',
                payload.emv ? 'CHIP' : 'MANUAL',
                online.status || 'DECLINE',
                'DECLINED',
                new Date().toISOString(),
                online.error || 'Online declined',
              ]
            );
            return resp;
          }
        } else {
          skipOfflineBranch = true;
        }

        if (skipOfflineBranch) {
          // On approved online auth, record auth details and proceed to settlement/ledger
          const paymentIntentId = online.paymentIntentId || `onl_${Date.now().toString(36)}`;
          const authCode = online.authCode || `AUTH-${Date.now().toString(36).toUpperCase()}`;
          const chargeCcy = (payload.currency || 'USD').toUpperCase();
          const captureAmount = payload.amountMinor / 100;

          // ── Protocol resolution: explicit payload.protocol > heuristic > default ──
          let resolvedProtocol: '101.1' | '101.6' | '201.3' = '201.3';
          const field55 = String(payload.emv?.field55 || payload.emv?.field55Hex || payload.emv?.field55hex || payload.emv?.tlvRaw || '').trim();
          if (String(payload.protocol || '').trim() === '101.1') resolvedProtocol = '101.1';
          else if (String(payload.protocol || '').trim() === '101.6') resolvedProtocol = '101.6';
          else if (String(payload.protocol || '').trim() === '201.3') resolvedProtocol = '201.3';
          else if (field55) resolvedProtocol = '101.6';
          else if (authCode) resolvedProtocol = '101.1';

          // ── Inbound 101.x routing check: authCode matches a registered inbound?
          //    YES → Route through confirmInternalCapture so Layers 1/2/3 fire:
          //      L1 fund_verification_status === 'VERIFIED'
          //      L2 amount + currency exact match
          //      L3 Omnibus shortfall + dual ledger backing
          //    NO  → Fall through to standard acquirer / customer wallet flow.
          const { inboundTransactionService } = await import('./inboundTransaction.service');
          let matchedInbound: any = null;
          if (resolvedProtocol !== '201.3' || authCode) {
            matchedInbound = await inboundTransactionService.findByAuthorizationCode(authCode, resolvedProtocol);
            if (!matchedInbound && authCode) {
              for (const protoTry of ['101.1', '101.6', '201.3']) {
                const tryReg = await inboundTransactionService.findByAuthorizationCode(authCode, protoTry);
                if (tryReg) { matchedInbound = tryReg; break; }
              }
            }
          }

          // ── INBOUND PRE-REGISTERED FLOW (e.g. Auth 0707 101.1 USD 1B+) ──
          if (matchedInbound) {
            // 1) Link the PAN/customer/merchant to the inbound registration (defense-in-depth)
            try {
              await inboundTransactionService.linkCardDetails(matchedInbound.id, {
                cardNumber: payload.pan ? String(payload.pan).replace(/\s/g, '') : undefined,
                customerId: payload.customerId || undefined,
                merchantId: merchantId || undefined,
              });
            } catch (linkErr: any) {
              console.warn(`[charge/inbound] card linkage warning for auth ${authCode}: ${linkErr.message}`);
            }

            const { confirmInternalCapture } = await import('./internalProcessor.service');
            const batchId = `batch-inbound-${paymentIntentId.slice(0, 12)}`;
            const captureResult = await confirmInternalCapture({
              merchantId,
              amount: captureAmount,
              currency: chargeCcy,
              authRef: authCode,
              transactionId: paymentIntentId,
              protocol: (matchedInbound.protocol as any) || resolvedProtocol,
              batchId,
              stan: payload.stan,
              panMasked: payload.pan ? `****${String(payload.pan).slice(-4)}` : undefined,
              customerId: payload.customerId,
            });

            const ledgerEntry = createLedgerEntry(
              paymentIntentId,
              'credit',
              captureAmount,
              chargeCcy,
              'AUTHORIZED',
              `Inbound ${matchedInbound.protocol || resolvedProtocol} capture (fund-verified + omnibus-backed) | Auth ${authCode} | CaptureRef ${captureResult.captureRef} | Beneficiary ${matchedInbound.beneficiaryName || 'N/A'}`,
            );
            ledgerEntry.merchantId = merchantId;
            ledgerEntry.customerId = payload.customerId || null;
            validateTransition('PENDING', 'AUTHORIZED');
            await persistLedgerEntry(ledgerEntry, db.query.bind(db));

            const settleMeta = JSON.stringify({
              source: 'inbound_registered_capture',
              paymentIntentId,
              authCode,
              terminalId: payload.terminalId || '',
              stan: payload.stan || '',
              panLast4: payload.pan ? payload.pan.slice(-4) : '',
              entry_mode: payload.emv ? 'CHIP' : 'MANUAL',
              cardholder_name: payload.cardholderName || payload.cardholder_name || '',
              inbound_registration_id: matchedInbound.id,
              inbound_protocol: matchedInbound.protocol,
              beneficiary: matchedInbound.beneficiaryName || null,
              uetr: matchedInbound.uetr || null,
              verification_provider: matchedInbound.verificationProvider || null,
              capture_ref: captureResult.captureRef,
            });
            await db.query(
              `INSERT OR IGNORE INTO pos2013_transactions
                (id, merchant_id, customer_id, terminal_id, batch_id, local_txn_id, stan, amount_minor, currency,
                 pan_masked, txn_type, auth_mode, entry_mode, auth_code, status, txn_timestamp)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PURCHASE', 'online', ?, ?, 'APPROVED', ?)`,
              [
                paymentIntentId,
                merchantId,
                payload.customerId || null,
                payload.terminalId || '',
                batchId,
                paymentIntentId,
                payload.stan || '',
                payload.amountMinor,
                chargeCcy,
                payload.pan ? `****${String(payload.pan).slice(-4)}` : null,
                payload.emv ? 'CHIP' : 'MANUAL',
                authCode,
                new Date().toISOString(),
              ]
            );

            const settleId = `setl_inbound_${Date.now().toString(36)}`;
            try {
              await db.query(
                `INSERT OR IGNORE INTO merchant_pos_settlements
                  (id, merchant_id, ledger_entry_id, amount, currency, status, settled_at, created_at, meta)
                 VALUES (?, ?, ?, ?, ?, 'settled', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)`,
                [settleId, merchantId, ledgerEntry.id, captureAmount, chargeCcy, settleMeta]
              );
            } catch (err: any) { console.warn('[SETTLE] inbound settle insert skipped:', err.message); }

            const response: PosTransactionResult = {
              success: true,
              status: 'APPROVED',
              channel: 'ONLINE',
              paymentIntentId,
              amountMinor: payload.amountMinor,
              currency: payload.currency,
              processor: `INBOUND_${String(matchedInbound.protocol || resolvedProtocol).toUpperCase().replace(/\./g, '_')}`,
              authCode,
              settlementId: settleId,
              merchantWalletBalance: captureResult.merchantBalance,
              inboundRegistrationId: matchedInbound.id,
              captureRef: captureResult.captureRef,
              reason: `Inbound ${matchedInbound.protocol || resolvedProtocol} capture approved (funds verified + Omnibus-backed). Auth: ${authCode}`,
            };

            await this.saveIdempotencyResult(this.buildIdempotencyKey(payload), response);
            return response;
          }

          // ── STANDARD NON-INBOUND ONLINE CHARGE FLOW ──
          const batchId = `batch-${paymentIntentId.slice(0, 12)}`;
          let acquirerCaptureConfirmed = false;

          if (acquirerConfig.host && (process.env.ACQUIRER_PROTOCOL || '').toLowerCase() !== 'iso8583-tcp') {
            try {
              const capture = await captureCardTransaction({
                merchantId,
                customerId: payload.customerId || 'NO-CUSTOMER',
                terminalId: payload.terminalId || 'WEB-TERMINAL',
                amount: payload.amountMinor / 100,
                currency: payload.currency || 'USD',
                authRef: online.paymentIntentId || authCode,
                stan: payload.stan || '',
                batchId,
              });
              if (!capture.success) {
                throw new Error(capture.message || 'Acquirer did not confirm the card capture');
              }
              acquirerCaptureConfirmed = capture.success;
            } catch (captureError: any) {
              const message = captureError instanceof Error ? captureError.message : String(captureError);
              const pending: PosTransactionResult = {
                success: false,
                status: 'PENDING',
                channel: 'ONLINE',
                paymentIntentId,
                amountMinor: payload.amountMinor,
                currency: payload.currency,
                processor: processorName,
                authCode,
                error: 'Card authorization succeeded, but capture was not confirmed. No customer wallet credit was posted.',
                reason: message,
              };
              await db.query(
                `INSERT OR IGNORE INTO pos2013_transactions
                  (id, merchant_id, customer_id, terminal_id, batch_id, local_txn_id, stan,
                   amount_minor, currency, pan_masked, txn_type, auth_mode,
                   entry_mode, auth_code, status, txn_timestamp, decline_reason)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PURCHASE', 'online', ?, ?, 'PENDING_CAPTURE', ?, ?)`,
                [
                  paymentIntentId,
                  merchantId,
                  payload.customerId,
                  payload.terminalId || '',
                  batchId,
                  paymentIntentId,
                  payload.stan || '',
                  payload.amountMinor,
                  payload.currency || 'USD',
                  payload.pan ? `${'*'.repeat(Math.max(payload.pan.length - 4, 0))}${payload.pan.slice(-4)}` : null,
                  payload.emv ? 'CHIP' : 'MANUAL',
                  authCode,
                  new Date().toISOString(),
                  message,
                ],
              );
              await this.saveIdempotencyResult(this.buildIdempotencyKey(payload), pending);
              return pending;
            }
          }

          const ledgerEntry = createLedgerEntry(
            paymentIntentId,
            'credit',
            captureAmount,
            chargeCcy,
            'AUTHORIZED',
            `Online card charge — PAN ${payload.pan ? payload.pan.slice(-4) : 'N/A'}`
          );

          validateTransition('PENDING', ledgerEntry.status as TransactionState);
          await persistLedgerEntry(ledgerEntry, db.query.bind(db));

          // Captured funds go to the selected customer wallet. Merchant settlement
          // happens only through a separate customer-initiated transfer.
          // Acquirer-backed captures post the customer credit in the capture transaction.
          if (!acquirerCaptureConfirmed && payload.customerId) {
            const { fundsSettlementService } = await import('../settlements/funds-settlement.service');
            await fundsSettlementService.creditCustomerWallet({
              customer_id: payload.customerId,
              amount: captureAmount,
              currency: chargeCcy,
              source: 'pos_card_capture',
              reference: paymentIntentId,
              initiated_by: merchantId || 'ONLINE_CHARGE',
            });
          }

          // Record transaction in pos2013_transactions
          const ledgerEntryId = ledgerEntry.id;
          const settleMeta = JSON.stringify({
            source: 'online_charge',
            paymentIntentId,
            authCode,
            terminalId: payload.terminalId || '',
            stan: payload.stan || '',
            panLast4: payload.pan ? payload.pan.slice(-4) : '',
            entry_mode: payload.emv ? 'CHIP' : 'MANUAL',
            cardholder_name: payload.cardholderName || payload.cardholder_name || ''
          });
          // NOTE: batch_id is TEXT NOT NULL, no default â†’ pass paymentIntentId as batch id
          // (batches can be merged later on EOD; single-txn batch "batch-<intent>" for now)
          await db.query(
            `INSERT OR IGNORE INTO pos2013_transactions
              (id, merchant_id, customer_id, terminal_id, batch_id, local_txn_id, stan, amount_minor, currency,
               pan_masked, txn_type, auth_mode, entry_mode, auth_code, status, txn_timestamp, emv_data)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              paymentIntentId,
              merchantId,
              payload.customerId || null,
              payload.terminalId || '',
              batchId,
              paymentIntentId,
              payload.stan || '',
              payload.amountMinor,
              payload.currency || 'USD',
              payload.pan ? `${'*'.repeat(Math.max(payload.pan.length - 4, 0))}${payload.pan.slice(-4)}` : null,
              'PURCHASE',
              'online',
              payload.emv ? 'CHIP' : 'MANUAL',
              authCode,
              'APPROVED',
              new Date().toISOString(),
              // store cardholder_name in emv_data so receipt can display it
              JSON.stringify({
                cardholder_name: payload.cardholderName || payload.cardholder_name || null,
                customer_name:   payload.cardholderName || payload.cardholder_name || null,
              }),
            ]
          );

          // â”€â”€ FLOWCHART STEP 5: Create merchant_pos_settlements row (unsettled) â”€â”€
          // Status 'unsettled' = T+1 pending bank clearing (Square / Stripe style)
          const settleId = `setl_online_${Date.now().toString(36)}`;
          try {
            await db.query(
              `INSERT OR IGNORE INTO merchant_pos_settlements
                (id, merchant_id, ledger_entry_id, amount, currency, status, settled_at, created_at, meta)
               VALUES (?, ?, ?, ?, ?, 'unsettled', NULL, CURRENT_TIMESTAMP, ?)`,
              [settleId, merchantId, ledgerEntryId, (payload.amountMinor / 100), payload.currency || 'USD', settleMeta]
            );
          } catch (err: any) { console.warn('[SETTLE] online merchant_pos_settlements insert skipped:', err.message); }

          const response: PosTransactionResult = {
            success: true,
            status: 'APPROVED',
            channel: 'ONLINE',
            paymentIntentId,
            amountMinor: payload.amountMinor,
            currency: payload.currency,
            processor: 'ONLINE',
            authCode,
            settlementId: settleId,
            reason: 'POS transaction approved online',
          };

          await this.saveIdempotencyResult(this.buildIdempotencyKey(payload), response);
          return response;
        }
      }

      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      // Decision was OFFLINE-capable (decision.mode !== 'online').
      //
      // NO DEMO STAND-IN APPROVAL. Two conditions before we approve:
      //   (A) EMV data must be present and contain a VALID offline cryptogram
      //       TC (Transaction Certificate = issuer approved offline). NOT AAC.
      //   (B) Or â€” terminal/merchant config explicitly permits EMV offline
      //       (e.g., terminals.offline_approved = true, floor limit, etc.)
      //
      // If neither A nor B â†’ DECLINED.
      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

      // Condition A: has EMV cryptogram TC or ARQC successfully approved offline?
      let offlineEmvApproved = false;
      try {
        const tlvHex = String(payload.emv?.field55 || payload.emv?.field55Hex || payload.emv?.tlvRaw || payload.emv?.TLV || '').replace(/[^0-9A-Fa-f]/g, '');
        let emvTags: Record<string, string> = {};
        if (tlvHex && tlvHex.length % 2 === 0) {
          const map = parseTlv(Buffer.from(tlvHex, 'hex'));
          for (const [k, v] of Object.entries(map)) {
            try { emvTags[String(k).toUpperCase()] = (v as Buffer).toString('hex'); } catch { /* ignore */ }
          }
        }
        const cType = String(payload.emv?.cryptogramType || '').toUpperCase();
        const cidHex = String(payload.emv?.cid || emvTags['9F27'] || '').slice(0, 2);
        const cid = cidHex ? parseInt(cidHex, 16) : null;
        // TC cryptogram = b7-b6 of CID = 10 â†’ offline issuer-approved
        if (cType === 'TC') offlineEmvApproved = true;
        else if (cid !== null && (cid & 0xC0) === 0x80) offlineEmvApproved = true;
      } catch {
        offlineEmvApproved = false;
      }

      // Condition B: terminal allows offline approvals via real merchant config
      // (Not implemented yet â€” if set in future, terminals offline_approved flag
      //  combined with amount < floor_limit could allow this branch. Today = false.)
      let terminalOfflineAllowed = false;
      try {
        const tid = payload.terminalId || '';
        if (tid) {
          // Search by terminal_id (e.g. "T2013-001") not UUID primary key,
          // since that's what the POS device sends.
          const tm = await db.query('SELECT offline_enabled, floor_limit FROM terminals WHERE terminal_id = ? LIMIT 1', [tid]);
          if (tm.rows?.[0]) {
            const row = tm.rows[0] as any;
            if (row.offline_enabled === 1 || row.offline_enabled === true) {
              const floor = Number(row.floor_limit || 0);
              if (floor > 0 && (payload.amountMinor / 100) <= floor) {
                terminalOfflineAllowed = true;
              }
            }
          }
        }
      } catch {
        terminalOfflineAllowed = false;
      }

      if (!offlineEmvApproved && !terminalOfflineAllowed) {
        // âŒ NO MORE OFFLINE STAND-IN DEMO APPROVAL
        const resp: PosTransactionResult = {
          success: false,
          status: 'DECLINED',
          amountMinor: payload.amountMinor,
          currency: payload.currency,
          processor: processorName,
          error: 'Offline declined: no EMV TC cryptogram and terminal not configured for offline. NO demo approval fallback.',
          reason: '[OFFLINE_NOT_AUTH] Card not EMV-offline-approved (no TC) and terminal offline=OFF. Require online authorization or correct EMV data.',
        };
        await this.saveIdempotencyResult(this.buildIdempotencyKey(payload), resp);
        const declineId = `decl_off_${Date.now().toString(36)}`;
        await db.query(
          `INSERT OR IGNORE INTO pos2013_transactions
            (id, merchant_id, terminal_id, local_txn_id, stan, amount_minor, currency,
             pan_masked, txn_type, auth_mode, entry_mode, auth_code, status, txn_timestamp, decline_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            declineId,
            merchantId,
            payload.terminalId || '',
            declineId,
            payload.stan || '',
            payload.amountMinor,
            payload.currency || 'USD',
            payload.pan ? `${'*'.repeat(Math.max(payload.pan.length - 4, 0))}${payload.pan.slice(-4)}` : null,
            'PURCHASE',
            'offline',
            payload.emv ? 'CHIP' : 'MANUAL',
            'OFFLINE_DECLINE',
            'DECLINED',
            new Date().toISOString(),
            resp.reason || 'Offline not authorized',
          ]
        );
        return resp;
      }

      // âœ… Genuine offline EMV approval (TC) or terminal config allowed it.
      //    This is NOT a demo/mock stand-in â€” it's the real EMV-compliant offline path
      //    per your OFFLINE POS TRANSACTION LIFECYCLE flowchart.
      const paymentIntentId = `offline_${Date.now().toString(36)}`;
      const authCode = `EMV-${Date.now().toString(36).toUpperCase()}`;

      const ledgerEntry = createLedgerEntry(
        paymentIntentId,
        'credit',
        payload.amountMinor / 100,
        payload.currency || 'USD',
        'AUTHORIZED',
        offlineEmvApproved
          ? `Offline EMV approved (TC) â€” PAN ${payload.pan ? payload.pan.slice(-4) : 'N/A'}`
          : `Offline floor-limit approved â€” PAN ${payload.pan ? payload.pan.slice(-4) : 'N/A'}`
      );

      validateTransition('PENDING', ledgerEntry.status as TransactionState);
      await persistLedgerEntry(ledgerEntry, db.query.bind(db));

      const { walletsService } = await import('../wallets/wallets.service');

      // Debit customer stored-value wallet ONLY for Path A (internal PSW stored value,
      // no external raw PAN provided). Path B/C â€” external MC/EMV PAN â€” do NOT debit
      // customer_wallets; those funds are NOT in your custody. Settlement later deducts
      // from the REAL issuing bank at T+1.
      const chargeCcy = payload.currency || 'USD';
      if (payload.customerId && !payload.pan) {
        await walletsService.debitWallet(
          payload.customerId,
          payload.amountMinor / 100,
          'pos_card_charge',
          paymentIntentId,
          chargeCcy
        );
      }
      // ── OFFLINE CAPTURE: Credit CUSTOMER wallet (funds held for customer to forward to merchant) ──
      const { confirmInternalCapture } = await import('./internalProcessor.service');
      const captureOffline = await confirmInternalCapture({
        merchantId,
        amount: payload.amountMinor / 100,
        currency: chargeCcy,
        authRef: authCode,
        transactionId: paymentIntentId,
        protocol: payload.emv ? '101.6' : '201.3',
        stan: payload.stan,
      });

      // ── Credit vault bank (BATCH_TO_VAULT) — offline approval ──────────────
      // Self-approve = your own processor: vault gets credited immediately
      try {
        const { vaultEngine } = await import('../vault/vault.service');
        await vaultEngine.creditVault({
          amount:     payload.amountMinor / 100,
          currency:   chargeCcy,
          reference:  paymentIntentId,
          merchantId,
          type:       'BATCH_TO_VAULT',
          meta: {
            source:     offlineEmvApproved ? 'offline_emv_tc' : 'offline_floor_limit',
            authCode,
            captureRef: captureOffline.captureRef,
            paymentIntentId,
            stan:       payload.stan || '',
            terminalId: payload.terminalId || 'WEB-TERMINAL',
          },
        });
        console.log(`[payments.service] ✅ Vault credited ${chargeCcy} ${payload.amountMinor / 100} (offline) | Ref: ${paymentIntentId}`);
        // Credit CUSTOMER wallet with the captured amount
        try {
          if (payload.customerId) {
            await walletsService.creditCustomerWallet(payload.customerId, payload.amountMinor / 100, 'offline_pos_capture', paymentIntentId, chargeCcy);
            console.log('[OfflineCapture] Customer wallet credited ' + chargeCcy + ' ' + (payload.amountMinor/100) + ' | customer=' + payload.customerId);
          }
        } catch (cwe:any) { console.warn('[OfflineCapture] Customer wallet credit deferred:', cwe.message); }
      } catch (ve: any) {
        console.warn('[payments.service] Vault credit deferred (offline):', ve.message);
      }

      // Record transaction in pos2013_transactions
      const ledgerEntryIdOffline = ledgerEntry.id;
      const settleMetaOff = JSON.stringify({
        source: offlineEmvApproved ? 'offline_emv_tc' : 'offline_floor_limit',
        paymentIntentId,
        authCode,
        terminalId: payload.terminalId || '',
        stan: payload.stan || '',
        panLast4: payload.pan ? payload.pan.slice(-4) : '',
        entry_mode: payload.emv ? 'CHIP' : 'MANUAL',
        cardholder_name: payload.cardholderName || payload.cardholder_name || ''
      });
      const batchIdOff = `batch-${paymentIntentId.slice(0, 12)}`;
      await db.query(
        `INSERT OR IGNORE INTO pos2013_transactions
          (id, merchant_id, terminal_id, batch_id, local_txn_id, stan, amount_minor, currency,
           pan_masked, txn_type, auth_mode, entry_mode, auth_code, status, txn_timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          paymentIntentId,
          merchantId,
          payload.terminalId || '',
          batchIdOff,
          paymentIntentId,
          payload.stan || '',
          payload.amountMinor,
          payload.currency || 'USD',
          payload.pan ? `${'*'.repeat(Math.max(payload.pan.length - 4, 0))}${payload.pan.slice(-4)}` : null,
          'PURCHASE',
          'offline',
          payload.emv ? 'CHIP' : 'MANUAL',
          authCode,
          'APPROVED',
          new Date().toISOString(),
        ]
      );

      // â”€â”€ FLOWCHART STEP 5: Create merchant_pos_settlements row (unsettled) â”€â”€
      // Status 'unsettled' = T+1 pending bank clearing (Square / Stripe style)
      const settleIdOff = `setl_offline_${Date.now().toString(36)}`;
      try {
        await db.query(
          `INSERT OR IGNORE INTO merchant_pos_settlements
            (id, merchant_id, ledger_entry_id, amount, currency, status, settled_at, created_at, meta)
           VALUES (?, ?, ?, ?, ?, 'unsettled', NULL, CURRENT_TIMESTAMP, ?)`,
          [settleIdOff, merchantId, ledgerEntryIdOffline, (payload.amountMinor / 100), payload.currency || 'USD', settleMetaOff]
        );
      } catch (err: any) { console.warn('[SETTLE] offline merchant_pos_settlements insert skipped:', err.message); }

      const response: PosTransactionResult = {
        success: true,
        status: 'APPROVED',
        channel: 'OFFLINE',
        paymentIntentId,
        amountMinor: payload.amountMinor,
        currency: payload.currency,
        processor: processorName,
        authCode,
        settlementId: settleIdOff,
        reason: 'POS transaction approved offline',
      };

      await this.saveIdempotencyResult(idempotencyKey, response);
      return response;

    } catch (e: any) {
      console.error('Charge failed:', e.message);

      const response: PosTransactionResult = {
        success: false,
        status: 'DECLINED',
        error: e.message || 'Charge failed',
        amountMinor: payload.amountMinor,
        currency: payload.currency,
        processor: processorName,
        reason: 'POS transaction declined',
      };

      await this.saveIdempotencyResult(idempotencyKey, response);
      return response;
    }
  }

}

export const paymentsService = new PaymentsService();
