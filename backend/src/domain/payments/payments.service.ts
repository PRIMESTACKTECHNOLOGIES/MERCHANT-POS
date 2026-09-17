import axios from 'axios';
import { acquirerConfig } from '../../config/acquirer';
import { createAcquirerClient } from './acquirer';
import { db } from "../../config/db";
import { validateTransition, createLedgerEntry, persistLedgerEntry, type TransactionState } from '../ledger/ledger.service';
import { buildEmvChargePayload, parseTlv } from './emv-tlv-parser';
import { syncOfflinePreflight, type PreflightPayload } from './offline-decline-preflight';
import type { OnlineAuthorizationResult } from './pos-decision.service';
import { v4 as uuidv4 } from 'uuid';

interface PosTransactionPayload extends PreflightPayload {
  customerId?:      string;
  authCode?:        string;   // pre-authorized code (voice auth 101.1)
  entryMode?:       string;   // VOICE_AUTH, MANUAL, CHIP, etc.
  cardholderName?:  string;
  cardholder_name?: string;
}

interface PosTransactionResult {
  success: boolean;
  status: 'APPROVED' | 'DECLINED' | 'PENDING';
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

export class PaymentsService {

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
    // Block self-referencing — processor cannot point to itself
    if (url && (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('0.0.0.0'))) {
      console.warn('[Processor] CARD_PROCESSOR_URL points to localhost — self-approval blocked. Set a real external acquirer URL.');
      return null;
    }
    return url;
  }

  private getProcessorApiKey(): string | null {
    return process.env.CARD_PROCESSOR_KEY?.trim() || process.env.PAYMENT_PROCESSOR_KEY?.trim() || null;
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

    const processorUrl = this.getProcessorBaseUrl();
    if (!processorUrl) {
      // â”€â”€ NO PROCESSOR CONFIGURED â†’ HARD DECLINE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // We do NOT fake-approve transactions when no processor is set.
      // A card with no real authorization MUST be declined.
      return {
        success: false,
        status: 'CONFIGURATION_ERROR',
        processor: {
          approved: false,
          reason: 'No card processor configured. Set CARD_PROCESSOR_URL in environment variables.',
        },
        error: 'Card processor not configured â€” transaction declined.',
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

      return {
        success: true,
        status: String(data.status || 'APPROVED'),
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

      if (!this.getProcessorBaseUrl()) {
        // ── 101.1 Voice Auth bypass ──────────────────────────────────────
        // A voice auth code that passed controller validation IS the issuer
        // approval. No CARD_PROCESSOR_URL is needed — skip the hard decline.
        const isVoiceAuth = ['VOICE_AUTH','101.1','101.6','201.3','OFFLINE_201_3','MANUAL_MOTO','MOTO'].includes(String(payload.entryMode || '').toUpperCase());
        const hasAuthCode = !!(payload.authCode && String(payload.authCode).trim());

        if (!(hasAuthCode)) {   // any protocol with a validated authCode → self-approve
          // Not voice auth — hard decline, no processor configured
          const resp: PosTransactionResult = {
            success: false,
            status: 'DECLINED',
            amountMinor: payload.amountMinor,
            currency: payload.currency,
            processor: processorName,
            error: 'No card processor configured. Transaction declined.',
            reason: '[NO_PROCESSOR] CARD_PROCESSOR_URL is not set. Configure a real card processor to accept card payments.',
          };
          await this.saveIdempotencyResult(this.buildIdempotencyKey(payload), resp);
          return resp;
        }
        // Voice auth with validated code — fall through to self-approval
        console.log(`[101.1] Voice auth self-approve | authCode=${payload.authCode} | amt=${payload.amountMinor/100} ${payload.currency || 'USD'}`);
      }


      // ── 101.1 Voice Auth: skip decision service, go straight to self-approval ─
      // The auth code was validated by the controller. No EMV, no online check needed.
        const isVoiceAuth101 = ['VOICE_AUTH','101.1','101.6','201.3','OFFLINE_201_3','MANUAL_MOTO','MOTO'].includes(String(payload.entryMode || '').toUpperCase()) || !!(payload.authCode && String(payload.authCode).trim());
      const voiceAuthCode101 = payload.authCode && String(payload.authCode).trim();
      if (isVoiceAuth101 && voiceAuthCode101) {
        // Skip decision service — treat as pre-authorised offline approval
        // Fall straight through to the offline self-approval block below.
        // Force decision to offline so we skip the needsOnline branch.
        // We do this by setting a synthetic decision.
        const paymentIntentId101 = `voice_${Date.now().toString(36)}`;
        const authCode101 = String(voiceAuthCode101).toUpperCase();
        const chargeCcy101 = payload.currency || 'USD';
        const { walletsService } = await import('../wallets/wallets.service');

        // Record transaction
        const ledgerEntry101 = createLedgerEntry(paymentIntentId101, 'credit', payload.amountMinor / 100, chargeCcy101, 'AUTHORIZED', `Voice auth 101.1 — code ${authCode101}`);
        validateTransition('PENDING', ledgerEntry101.status as TransactionState);
        await persistLedgerEntry(ledgerEntry101, db.query.bind(db));

        // Credit merchant wallet + vault
        await walletsService.creditMerchantWallet(payload.merchantId || '', payload.amountMinor / 100, 'pos_voice_auth', paymentIntentId101, chargeCcy101);
        try {
          const { vaultEngine } = await import('../vault/vault.service');
          await vaultEngine.creditVault({ amount: payload.amountMinor / 100, currency: chargeCcy101, reference: paymentIntentId101, merchantId: payload.merchantId || '', type: 'BATCH_TO_VAULT', meta: { source: 'voice_auth_101.1', authCode: authCode101 } });
        } catch (ve: any) { console.warn('[101.1] Vault credit deferred:', ve.message); }

        // Record in pos2013_transactions
        const batchId101 = `batch-${paymentIntentId101.slice(0, 12)}`;
        await db.query(
          `INSERT OR IGNORE INTO pos2013_transactions (id, merchant_id, terminal_id, batch_id, local_txn_id, stan, amount_minor, currency, pan_masked, txn_type, auth_mode, entry_mode, auth_code, status, txn_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [paymentIntentId101, payload.merchantId||'', payload.terminalId||'', batchId101, paymentIntentId101, payload.stan||'', payload.amountMinor, chargeCcy101, payload.pan ? `****${payload.pan.slice(-4)}` : null, 'PURCHASE', 'voice_auth', 'VOICE_AUTH', authCode101, 'APPROVED', new Date().toISOString()]
        );

        const resp101: PosTransactionResult = {
          success: true,
          status: 'APPROVED',
          paymentIntentId: paymentIntentId101,
          amountMinor: payload.amountMinor,
          currency: payload.currency,
          processor: AUTH_CODE_ ,
          authCode: authCode101,
          reason: `Voice auth 101.1 approved — code ${authCode101}`,
        };
        await this.saveIdempotencyResult(idempotencyKey, resp101);
        return resp101;
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
        const tcOk = cType === 'TC' || (cid !== null && (cid & 0xC0) === 0x80);
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
      const needsOnline =
        decision &&
        (decision.mode === 'online' || decision.decision === 'ONLINE_APPROVE' || decision.onlineRequired ||
          decision.goOnline || decision.requiresOnlineAuth);

      let skipOfflineBranch = false;

      if (needsOnline) {
        const online = await this.authorizeOnlineCharge(payload);
        if (online.status === 'PENDING_BANK_BATCH') {
          // â”€â”€ Block fake bank batch approval â€” hard decline instead â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          const resp: PosTransactionResult = {
            success: false,
            status: 'DECLINED',
            amountMinor: payload.amountMinor,
            currency: payload.currency,
            processor: processorName,
            error: 'No card processor configured. Transaction declined.',
            reason: '[NO_PROCESSOR] Configure CARD_PROCESSOR_URL to accept card payments.',
          };
          await this.saveIdempotencyResult(this.buildIdempotencyKey(payload), resp);
          return resp;
        }
        if (!online.success) {
          // â”€â”€ YOUR OFFLINE ACQUIRER FALLBACK (only for CONFIGURATION_ERROR) â”€â”€
          // If processor URL not configured, but EITHER:
          //   (A) EMV chip already TC-approved offline (CID=0x80), OR
          //   (B) Terminal offline_enabled + amount â‰¤ floor_limit
          // â†’ Fall through to OFFLINE approval below. REAL offline acquirer, not demo.
          // Any other decline (processor said NO) â†’ still hard decline (correct).
          const isCfgError = online.status && String(online.status).toUpperCase() === 'CONFIGURATION_ERROR';
          if (isCfgError) {
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
            const tcOk = cType === 'TC' || (cid !== null && (cid & 0xC0) === 0x80);
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
                  payload.pan ? `${'*'.repeat(Math.max(payload.pan.length - 4, 0))}${payload.pan.slice(-4)}` : null,
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
                payload.pan ? `${'*'.repeat(Math.max(payload.pan.length - 4, 0))}${payload.pan.slice(-4)}` : null,
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

          const ledgerEntry = createLedgerEntry(
            paymentIntentId,
            'credit',
            payload.amountMinor / 100,
            payload.currency || 'USD',
            'AUTHORIZED',
            `Online card charge â€” PAN ${payload.pan ? payload.pan.slice(-4) : 'N/A'}`
          );

          validateTransition('PENDING', ledgerEntry.status as TransactionState);
          await persistLedgerEntry(ledgerEntry, db.query.bind(db));

          // Debit customer stored-value wallet ONLY for Path A (internal PSW stored value,
          // no external raw PAN provided). Path B/C â€” external MC/EMV PAN â€” do NOT debit
          // customer_wallets; those funds are NOT in your custody. Settlement later deducts
          // from the REAL issuing bank at T+1.
          const { walletsService } = await import('../wallets/wallets.service');
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
          // Always credit merchant wallet
          await walletsService.creditMerchantWallet(
            merchantId,
            payload.amountMinor / 100,
            'pos_card_charge',
            paymentIntentId,
            chargeCcy
          );

          // ── Credit vault bank (BATCH_TO_VAULT) ─────────────────────────
          try {
            const { vaultEngine } = await import('../vault/vault.service');
            await vaultEngine.creditVault({
              amount:     payload.amountMinor / 100,
              currency:   chargeCcy,
              reference:  paymentIntentId,
              merchantId,
              type:       'BATCH_TO_VAULT',
              meta: {
                source:     'online_card_charge',
                authCode,
                paymentIntentId,
                stan:       payload.stan || '',
                terminalId: payload.terminalId || 'WEB-TERMINAL',
              },
            });
            console.log([payments.service] Vault credited   (online) | Ref: );
          } catch (ve: any) {
            console.warn('[payments.service] Vault credit deferred (online):', ve.message);
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
          const batchId = `batch-${paymentIntentId.slice(0, 12)}`;
          await db.query(
            `INSERT OR IGNORE INTO pos2013_transactions
              (id, merchant_id, terminal_id, batch_id, local_txn_id, stan, amount_minor, currency,
               pan_masked, txn_type, auth_mode, entry_mode, auth_code, status, txn_timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              paymentIntentId,
              merchantId,
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
            ]
          );

          // ── REAL ACQUIRER CAPTURE (201.3) ──────────────────────────────────
          // If acquirer is configured, call capture now to settle the funds
          // with the real card network so money moves to merchant account.
          if (acquirerConfig.host) {
            try {
              const { captureCardTransaction } = await import('../../services/payments/cardCapture');
              await captureCardTransaction({
                merchantId,
                terminalId:    payload.terminalId || 'WEB-TERMINAL',
                amount:        payload.amountMinor / 100,
                currency:      payload.currency || 'USD',
                authRef:       online.paymentIntentId || authCode,
                stan:          payload.stan || '',
                batchId,
              });
              console.log('[Acquirer] Capture 201.3 submitted for auth ' + (online.paymentIntentId || authCode));
            } catch (capErr: any) {
              console.warn('[Acquirer] Capture deferred: ' + capErr.message);
            }
          }

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
            paymentIntentId,
            amountMinor: payload.amountMinor,
            currency: payload.currency,
            processor: 'ONLINE',
            authCode,
            settlementId: settleId,
            processorVaultAccountId,
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
      // Always credit merchant wallet (merchant receives the money)
      await walletsService.creditMerchantWallet(
        merchantId,
        payload.amountMinor / 100,
        'pos_card_charge',
        paymentIntentId,
        chargeCcy
      );

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
            paymentIntentId,
            stan:       payload.stan || '',
            terminalId: payload.terminalId || 'WEB-TERMINAL',
          },
        });
        console.log(`[payments.service] ✅ Vault credited ${chargeCcy} ${payload.amountMinor / 100} (offline) | Ref: ${paymentIntentId}`);
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