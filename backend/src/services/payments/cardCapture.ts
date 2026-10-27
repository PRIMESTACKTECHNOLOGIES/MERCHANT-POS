/**
 * Card Capture Service (Protocol 201.3)
 * ─────────────────────────────────────────────────────────────────────────────
 * Calls the acquirer to capture a previously authorized transaction,
 * then credits the merchant wallet and records the settlement.
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import { isAcquirerConfigured, acquirerConfig } from '../../config/acquirer';
import { getAcquirerClient } from '../acquirer/HttpAcquirerClient';
import { walletsService } from '../../domain/wallets/wallets.service';
import { getProtocolConfig } from '../../core/PosProtocol';
import {
  getProcedure,
  listProceduresForProtocol,
  PROCESSING_PROCEDURES,
  MTI,
  POS_ENTRY_MODES,
  POS_CONDITION_CODES,
  PROCESSING_CODES,
  isApprovalResponse,
} from '../../pos/processingProcedures';
import { detectCardBrand, detectScheme } from '../../config/bin';
import { callVaultBankLedger } from '../../domain/vault/merchantVaultTransfer.service';
import {
  ensureFundProviderCallsTable,
  insertFundProviderCall,
  markFundProviderProviderResult,
  markFundProviderLedgerResult,
  type FundProviderCallStatus,
} from '../fundProviderAudit.service';
import axios, { AxiosError } from 'axios';

export type CaptureProcedureId =
  | 'PROC-DUAL-CAPTURE-2013'
  | 'PROC-PREAUTH-COMPLETION'
  | 'PROC-REFUND-2000'
  | 'PROC-VOID-SALE'
  | 'PROC-CLEARING-MSRCUSTOMER-1410'
  | 'PROC-CLEARING-ICCUSTOMER-1430';

export interface CardCaptureParams {
  merchantId:    string;
  terminalId?:   string;
  amount:        number;
  currency?:     string;
  authRef:       string;          // from cardAuthorization result
  transactionId?: string;         // internal ID from cardAuthorization
  stan?:         string;
  batchId?:      string;
  customerId?:   string;          // OPTIONAL — if provided, funds go to CUSTOMER wallet instead of merchant
  creditTarget?: 'merchant' | 'customer';  // explicit target, defaults to merchant for backward compat
  cardLast4?:    string;          // optional for brand detection + clearing 1410/1430 selection
  procedureId?:  CaptureProcedureId;
  processingCode?: string;        // DE3 (000000 sale capture / 004000 completion / 200000 refund)
  posEntryMode?: string;
  posCondition?: string;
  mti?:          string;          // default 0200 financial request
}

export interface CardCaptureResult {
  success:       boolean;
  captureRef:    string;
  responseCode:  string;
  amount:        number;
  currency:      string;
  settlementId:  string;
  message?:      string;
  procedureId?:  string;
  brandScheme?:  string;
  mtiRequest?:   string;
  mtiResponse?:  string;
  processingCode?: string;
  posEntryMode?: string;
  posCondition?: string;
  batchId?:      string;
  dualMessage?:  boolean;
  stepsEmitted?: { order: number; name: string; p2013Code?: string }[];
}

export async function captureCardTransaction(
  params: CardCaptureParams
): Promise<CardCaptureResult> {

  const ccy         = String(params.currency || 'USD').toUpperCase().trim();
  const amountMinor = Math.round(params.amount * 100);
  const stan        = params.stan || String(Date.now()).slice(-6);
  const terminalId  = params.terminalId || 'WEB-TERMINAL';

  if (!params.merchantId?.trim() || !params.authRef?.trim()
    || !Number.isFinite(params.amount) || params.amount <= 0
    || !/^[A-Z]{3}$/.test(ccy) || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('Invalid merchant, authorization, amount, or currency');
  }

  // ── Protocol 201.3 config + procedure resolution ─────────────────────────
  const protocolConfig = getProtocolConfig('201.3');
  if (amountMinor < protocolConfig.minAmountMinor || amountMinor > protocolConfig.maxAmountMinor) {
    throw new Error(`Capture amount outside 201.3 limits (${protocolConfig.minAmountMinor}-${protocolConfig.maxAmountMinor})`);
  }

  const procedure = (() => {
    if (params.procedureId && PROCESSING_PROCEDURES[params.procedureId]) return PROCESSING_PROCEDURES[params.procedureId];
    const candidates = listProceduresForProtocol('201.3');
    if (params.processingCode && /^20/.test(params.processingCode)) {
      return PROCESSING_PROCEDURES['PROC-REFUND-2000'] || candidates[0];
    }
    if (params.processingCode && /^0040/.test(params.processingCode)) {
      return PROCESSING_PROCEDURES['PROC-PREAUTH-COMPLETION'] || candidates[0];
    }
    return PROCESSING_PROCEDURES['PROC-DUAL-CAPTURE-2013'] || candidates[0];
  })();
  if (!procedure) throw new Error('No capture procedure found for protocol 201.3');

  // ── Optional brand detection (for clearing-type procedures) ─────────────
  const brandScheme = params.cardLast4 && /^\d{4}$/.test(params.cardLast4)
    ? detectScheme(params.cardLast4)
    : 'VISA';
  if (procedure.brandScope.length && !procedure.brandScope.includes('ALL') && !procedure.brandScope.includes(brandScheme as any)) {
    throw new Error(`Procedure ${procedure.id} brand scope excludes scheme ${brandScheme}`);
  }

  // ── Resolve ISO DE defaults via procedure steps ──────────────────────────
  type StepIsoDefaults = {
    mti?: string;
    processingCode?: string;
    posEntryMode?: string;
    posConditionCode?: string;
  };
  const stepDefaults: StepIsoDefaults = (procedure.steps || []).reduce<StepIsoDefaults>(
    (acc: StepIsoDefaults, s: { iso?: StepIsoDefaults }) => (s.iso ? { ...acc, ...(s.iso as StepIsoDefaults) } : acc),
    {} as StepIsoDefaults,
  );
  const resolvedMti = params.mti || stepDefaults.mti || MTI.DUAL_FINANCIAL_REQUEST;
  const resolvedProcessingCode = params.processingCode || stepDefaults.processingCode || PROCESSING_CODES.SALE_GOODS_SERVICES;
  const resolvedPosEntry = params.posEntryMode || stepDefaults.posEntryMode || POS_ENTRY_MODES.MAGSTRIPE_MANUAL_KEYED;
  const resolvedPosCondition = params.posCondition || stepDefaults.posConditionCode || POS_CONDITION_CODES.NORMAL;

  // ── Required DE validation ───────────────────────────────────────────────
  const requiredDeNumbers: number[] = Array.from(
    new Set<number>(
      (procedure.steps || [])
        .map((s: { iso?: { requiredFields?: number[] } }) => (s.iso?.requiredFields || []) as number[])
        .reduce<number[]>((acc: number[], arr: number[]) => acc.concat(arr), [] as number[]),
    ),
  ).sort((a: number, b: number) => a - b);
  const pseudoPan = params.cardLast4 ? `000000000000${params.cardLast4}` : undefined;
  const paramsAsDe: Record<number, string | undefined> = {
    2: pseudoPan,
    3: resolvedProcessingCode,
    4: String(amountMinor).padStart(12, '0'),
    11: stan,
    22: resolvedPosEntry,
    25: resolvedPosCondition,
    37: params.authRef,
    41: terminalId,
    42: params.merchantId,
    49: ccy === 'USD' ? '840' : ccy === 'EUR' ? '978' : ccy === 'GBP' ? '826' : '',
  };
  const missingDe: number[] = [];
  for (const de of requiredDeNumbers) {
    if (de === 52) continue;
    const v = paramsAsDe[de];
    if (v == null || v === '') missingDe.push(de);
  }
  if (missingDe.length) {
    throw new Error(`Procedure ${procedure.id} missing required ISO DEs: ${missingDe.join(',')}`);
  }

  const settlementId = uuidv4();
  const stepsEmitted: { order: number; name: string; p2013Code?: string }[] = [];
  const emitStep = async (step: { order: number; name: string; p2013Code?: string }, meta: Record<string, unknown> = {}) => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS procedure_events (
        id TEXT PRIMARY KEY,
        tx_id TEXT NOT NULL,
        procedure_id TEXT NOT NULL,
        step_order INTEGER NOT NULL,
        step_name TEXT NOT NULL,
        p2013_code TEXT,
        amount_minor INTEGER,
        currency TEXT,
        status TEXT NOT NULL DEFAULT 'EMITTED',
        meta_json TEXT,
        created_at TEXT NOT NULL
      )
    `);
    await db.query(
      `INSERT INTO procedure_events (id,tx_id,procedure_id,step_order,step_name,p2013_code,amount_minor,currency,status,meta_json,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uuidv4(), settlementId, procedure.id, step.order, step.name, (step as any).p2013Code || null,
        amountMinor, ccy, 'EMITTED', JSON.stringify(meta), new Date().toISOString(),
      ],
    );
    stepsEmitted.push({ order: step.order, name: step.name, p2013Code: (step as any).p2013Code });
  };
  for (const step of (procedure.steps || [])) {
    if ((step as any).iso?.mti) break;
    if (!(step as any).p2013Code && !(step as any).required) continue;
    await emitStep(step, { authRef: params.authRef, merchantId: params.merchantId, terminalId });
  }


  await db.query(`
    CREATE TABLE IF NOT EXISTS card_settlements (
      id              TEXT PRIMARY KEY,
      merchant_id     TEXT NOT NULL,
      customer_id     TEXT,
      credit_target   TEXT NOT NULL DEFAULT 'merchant',
      auth_ref        TEXT NOT NULL,
      capture_ref     TEXT NOT NULL,
      amount          REAL NOT NULL,
      currency        TEXT NOT NULL,
      protocol        TEXT NOT NULL DEFAULT '201.3',
      batch_id        TEXT,
      response_code   TEXT,
      status          TEXT NOT NULL DEFAULT 'SETTLED',
      acquirer_raw    TEXT,
      created_at      TEXT NOT NULL
    )
  `);

  for (const col of [
    ['customer_id', 'TEXT'],
    ['credit_target', `TEXT NOT NULL DEFAULT 'merchant'`],
  ]) {
    try { await db.query(`ALTER TABLE card_settlements ADD COLUMN ${col[0]} ${col[1]}`); } catch { /* exists */ }
  }

  const prior = await db.query(
    `SELECT * FROM card_settlements
      WHERE merchant_id = ? AND auth_ref = ?
      ORDER BY created_at DESC LIMIT 1`,
    [params.merchantId, params.authRef],
  );
  if (prior.rows?.length) {
    const row = prior.rows[0];
    if (Number(row.amount) !== params.amount || String(row.currency).toUpperCase() !== ccy) {
      throw new Error('Authorization was already captured for a different amount or currency');
    }
    return {
      success: true,
      captureRef: String(row.capture_ref),
      responseCode: String(row.response_code || '00'),
      amount: Number(row.amount),
      currency: String(row.currency),
      settlementId: String(row.id),
      message: 'Duplicate capture request replayed from stored settlement',
      procedureId: procedure.id,
      brandScheme,
      mtiRequest: resolvedMti,
      mtiResponse: MTI.DUAL_FINANCIAL_RESPONSE,
      processingCode: resolvedProcessingCode,
      posEntryMode: resolvedPosEntry,
      posCondition: resolvedPosCondition,
      batchId: params.batchId,
      dualMessage: (procedure as any).dualMessage,
    };
  }

  if (!isAcquirerConfigured()) {
    throw new Error(
      'Real acquirer is not configured. Set ACQUIRER_HOST in backend/.env to enable live card capture.'
    );
  }

  // ── Call acquirer capture ────────────────────────────────────────────────────
  const client   = getAcquirerClient();
  const capRes   = await client.capture({
    merchantAccount: acquirerConfig.merchantId,
    amountMinor,
    currency:        ccy,
    authRef:         params.authRef,
    protocol:        '201.3',
    stan,
    terminalId,
    processingCode:  resolvedProcessingCode,
    posEntryMode:    resolvedPosEntry,
    posCondition:    resolvedPosCondition,
    mti:             resolvedMti,
    batchId:         params.batchId,
  });

  const capRc = String(capRes.responseCode || '');
  const capApproved = capRes.success && isApprovalResponse(capRc);
  if (!capApproved) {
    const errStep = (procedure.steps || []).find((s: any) => s.errorStage) || { order: 99, name: 'Capture Declined' };
    await emitStep(errStep, { rc: capRc, declined: true, message: capRes.message });
    throw new Error(
      `Capture failed: RC=${capRc} — ${capRes.message || 'Declined by acquirer'}`
    );
  }

  const captureRef  = capRes.captureRef || `CAP-${uuidv4().slice(0, 8).toUpperCase()}`;
  const now          = new Date().toISOString();

  // ── Emit remaining post-online procedure steps ────────────────────────────
  for (const step of (procedure.steps || [])) {
    if ((step as any).iso?.mti && stepsEmitted.some((e: any) => e.order === step.order)) continue;
    if (!(step as any).iso?.mti && stepsEmitted.some((e: any) => e.order === step.order)) continue;
    await emitStep(step, { authRef: params.authRef, captureRef, rc: capRc, settlementId });
  }

  // ── VAULT BANK OMNIBUS CREDIT CONFIRMATION ──────────────────────────────
  // HARD CONSTRAINT: local wallet balances MUST NOT move until the external Vault
  // Bank Omnibus/Nostro account has been confirmed CREDITED via a real HTTP POST.
  // If the provider call fails, we BLOCK with status 402 (no ledger moves).
  // If the provider call succeeds but local DB commit fails → RECONCILE_NEEDED.
  await ensureFundProviderCallsTable();
  const effectiveTarget: 'merchant' | 'customer' =
    params.creditTarget === 'customer' ? 'customer'
      : params.customerId ? 'customer'
      : 'merchant';
  const vaultAuditMeta = effectiveTarget === 'customer' && params.customerId ? `customer${params.customerId}` : `merchant:${params.merchantId}`;
  const vaultIdempotencyKey = `VBCRED-${settlementId}`;
  const vaultAuditId = await insertFundProviderCall({
    flowType: 'CARD_CAPTURE_VAULT_BANK_OMNIBUS_CREDIT',
    providerName: 'VAULT_BANK',
    endpointUrl: process.env.VAULT_BANK_TRANSFER_URL?.trim() || 'http://127.0.0.1:9001/api/vault/settlement/credit',
    httpMethod: 'POST',
    rawApiKey: process.env.VAULT_BANK_API_KEY || null,
    idempotencyKey: vaultIdempotencyKey,
    requestPayload: {
      amount: params.amount,
      amountMinor,
      currency: ccy,
      reference: captureRef,
      merchantId: params.merchantId,
      customerId: params.customerId || null,
      creditTarget: effectiveTarget,
      authRef: params.authRef,
      stan,
      mti: resolvedMti,
      protocol: '201.3',
      type: 'card_capture_omnibus_credit',
      settlementId,
    },
    amountMinor,
    currency: ccy,
    walletOwnerType: effectiveTarget,
    walletOwnerId: effectiveTarget === 'customer' ? (params.customerId || params.merchantId) : params.merchantId,
    cardLast4: params.cardLast4 || null,
    protocol: '201.3',
    mti: resolvedMti,
    stan,
    authRef: params.authRef,
  });

  let vaultResponse: any = null;
  let vaultHttpStatus: number | null = null;
  let vaultResponseCode: string | null = null;
  let vaultReference: string | null = null;
  let vaultErrorMessage: string | null = null;
  let vaultConfirmed = false;

  try {
    vaultResponse = await callVaultBankLedger({
      direction: 'credit',
      amount: params.amount,
      currency: ccy,
      reference: captureRef,
      merchantId: params.merchantId,
      type: 'card_capture_201.3',
      meta: {
        settlementId,
        authRef: params.authRef,
        stan,
        mti: resolvedMti,
        creditTarget: effectiveTarget,
        customerId: params.customerId || null,
        batchId: params.batchId || null,
        brandScheme,
      },
    });
    vaultHttpStatus = 200;
    vaultConfirmed = true;
    vaultReference = String(vaultResponse?.id || vaultResponse?.transferId || vaultResponse?.reference || '') || null;
    vaultResponseCode = String(vaultResponse?.code || vaultResponse?.responseCode || '00');
  } catch (vaultErr: any) {
    const status =
      (vaultErr && (vaultErr.status || vaultErr.statusCode))
        ? Number(vaultErr.status || vaultErr.statusCode)
        : ((vaultErr as AxiosError)?.response?.status ?? null);
    vaultHttpStatus = status ?? null;
    vaultErrorMessage = String(vaultErr?.message || vaultErr || 'Vault Bank Omnibus credit not confirmed');
    vaultResponseCode = String(vaultErr?.code || vaultErr?.errorCode || '') || null;
  }

  await markFundProviderProviderResult({
    id: vaultAuditId,
    httpStatus: vaultHttpStatus,
    responseCodeProvider: vaultResponseCode,
    responseReference: vaultReference,
    responsePayload: vaultResponse ? (typeof vaultResponse === 'string' ? vaultResponse.slice(0, 4000) : JSON.stringify(vaultResponse).slice(0, 4000)) : null,
    errorMessage: vaultErrorMessage,
    success: vaultConfirmed,
  });

  if (!vaultConfirmed) {
    // HARD CONSTRAINT: BLOCK — do not move local wallet balances
    const blockedMsg =
      `Card capture was approved by acquirer (RC=${capRc}) BUT Vault Bank Omnibus credit was NOT confirmed. ` +
      `Local ledger NOT CREDITED. No funds moved. Vault Bank error: ${vaultErrorMessage || '(see fund_provider_calls id=' + vaultAuditId + ')'}`;
    const err = new Error(blockedMsg) as Error & { statusCode: number; code: string; vaultAuditId: string };
    err.statusCode = 402;
    err.code = 'PAYMENT_REQUIRED_VAULT_BANK_OMNIBUS_NOT_CONFIRMED';
    (err as any).vaultAuditId = vaultAuditId;
    throw err;
  }

  // ── Vault Bank Omnibus confirmed → credit local wallet ATOMICALLY ────────
  let ledgerSucceeded = false;
  let reconcileWarning: string | null = null;
  let walletIdCreditTarget: string | null = null;

  try {
    await db.query('BEGIN IMMEDIATE');
    await db.query(
      `INSERT INTO card_settlements
        (id, merchant_id, auth_ref, capture_ref, amount, currency, protocol, batch_id, response_code, acquirer_raw, created_at, customer_id, credit_target)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        settlementId, params.merchantId, params.authRef, captureRef, params.amount, ccy,
        '201.3', params.batchId || null, capRes.responseCode, JSON.stringify(capRes.raw || {}), now,
        effectiveTarget === 'customer' ? (params.customerId || null) : null,
        effectiveTarget,
      ],
    );

    if (effectiveTarget === 'customer' && params.customerId) {
      // ── CREDIT CUSTOMER WALLET DIRECTLY (101.1 / 101.6 / 201.3 → Customer)
      const customerWallet = await walletsService.getOrCreateWallet(params.customerId, ccy);
      walletIdCreditTarget = customerWallet.id;
      const txnId = uuidv4();
      const ref = captureRef;
      const description = `Card capture 201.3 | Auth: ${params.authRef}${params.batchId ? ` | Batch: ${params.batchId}` : ''}`;

      await db.query(
        'UPDATE customer_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [params.amount, customerWallet.id]
      );
      await db.query(
        `INSERT INTO wallet_transactions (id, wallet_id, type, amount, currency, source, reference, description, protocol, card_ref, auth_code, batch_id)
         VALUES (?, ?, 'credit', ?, ?, 'card_capture_201.3', ?, ?, '201.3', ?, ?, ?)`,
        [
          txnId, customerWallet.id, params.amount, ccy, ref, description,
          captureRef, capRes.responseCode || null, params.batchId || null,
        ]
      );
    } else {
      // ── DEFAULT: CREDIT MERCHANT WALLET (backward compat)
      const wallet = await walletsService.getOrCreateMerchantWallet(params.merchantId, ccy);
      walletIdCreditTarget = wallet.id;
      await db.query(
        'UPDATE merchant_wallets SET balance = balance + ?, updated_at = ? WHERE id = ?',
        [params.amount, now, wallet.id]
      );
      await db.query(`
        INSERT INTO merchant_wallet_transactions
          (id, wallet_id, type, amount, currency, source, reference, description, created_at)
        VALUES (?, ?, 'credit', ?, ?, 'card_capture', ?, ?, ?)
      `, [
        uuidv4(), wallet.id,
        params.amount, ccy,
        captureRef,
        `Card capture — Protocol 201.3 | Auth: ${params.authRef}`,
        now,
      ]);
    }
    await db.query('COMMIT');
    ledgerSucceeded = true;
  } catch (walletErr: any) {
    try { await db.query('ROLLBACK'); } catch { /* preserve original error */ }
    ledgerSucceeded = false;
    reconcileWarning =
      `!!! RECONCILE REQUIRED: Vault Bank Omnibus CREDIT was confirmed (ref=${vaultReference || 'unknown'}), ` +
      `BUT local ${effectiveTarget} wallet credit FAILED. ` +
      `Vault Bank amount=${ccy} ${params.amount}. Local wallet error: ${walletErr?.message || String(walletErr)}. ` +
      `Audit trail: settlement_id=${settlementId}, capture_ref=${captureRef}, auth_ref=${params.authRef}, vault_audit_id=${vaultAuditId}. ` +
      `MANUAL CREDIT to ${effectiveTarget} wallet required, then mark fund_provider_calls.ledger_status='LEDGER_SUCCESS' for id='${vaultAuditId}'.`;
    console.error('[cardCapture]', reconcileWarning);
  }

  await markFundProviderLedgerResult({
    id: vaultAuditId,
    walletId: walletIdCreditTarget,
    ledgerSuccess: ledgerSucceeded,
    reconcileWarning,
    errorMessage: reconcileWarning,
  });

  if (!ledgerSucceeded) {
    const err = new Error(
      `Vault Bank Omnibus was credited, but local ${effectiveTarget} wallet credit failed. MANUAL RECONCILIATION REQUIRED. ` +
      (reconcileWarning || '')
    ) as Error & { statusCode: number; code: string; reconcileWarning: string; vaultAuditId: string };
    err.statusCode = 502;
    err.code = 'LEDGER_POST_SUCCESS_RECONCILE_NEEDED';
    (err as any).reconcileWarning = reconcileWarning;
    (err as any).vaultAuditId = vaultAuditId;
    throw err;
  }

  // ── Update authorization record ──────────────────────────────────────────────
  if (params.transactionId) {
    try {
      await db.query(
        `UPDATE card_authorizations SET status = 'CAPTURED', captured_at = ? WHERE id = ?`,
        [now, params.transactionId]
      );
    } catch { /* ignore */ }
  }

  console.log(`[Acquirer] ✅ Capture 201.3 | ${ccy} ${params.amount} | RC=${capRes.responseCode} | CaptureRef=${captureRef} | Proc=${procedure.id}`);

  return {
    success:      true,
    captureRef,
    responseCode: capRc,
    amount:       params.amount,
    currency:     ccy,
    settlementId,
    message:      capRes.message,
    procedureId:  procedure.id,
    brandScheme,
    mtiRequest:   resolvedMti,
    mtiResponse:  capRes.mti || MTI.DUAL_FINANCIAL_RESPONSE,
    processingCode: resolvedProcessingCode,
    posEntryMode: resolvedPosEntry,
    posCondition: resolvedPosCondition,
    batchId:      params.batchId || capRes.batchRef || undefined,
    dualMessage:  (procedure as any).dualMessage,
    stepsEmitted,
  };
}
