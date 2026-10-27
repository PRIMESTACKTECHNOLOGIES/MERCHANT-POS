/**
 * Card Authorization Service (101.1 / 101.6)
 * ─────────────────────────────────────────────────────────────────────────────
 * Calls the real acquirer, stores the authorization in the DB,
 * and returns a structured result for the POS to record.
 *
 * Protocol 101.1 = manual/voice auth (card + expiry, no CVV required)
 * Protocol 101.6 = online EMV chip auth (card + expiry + EMV field 55)
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import { isAcquirerConfigured, acquirerConfig, assertAmountWithinTestCapOrThrow } from '../../config/acquirer';
import { getAcquirerClient } from '../acquirer/HttpAcquirerClient';
import {
  getProtocolConfig,
  PosProtocol,
} from '../../core/PosProtocol';
import {
  getProcedure,
  listProceduresForProtocol,
  PROCESSING_PROCEDURES,
  RESPONSE_CODES,
  POS_ENTRY_MODES,
  POS_CONDITION_CODES,
  PROCESSING_CODES,
  MTI,
  isApprovalResponse,
} from '../../pos/processingProcedures';
import { detectCardBrand, detectScheme } from '../../config/bin';
import { getBrandParams } from '../../config/brand';

export type AuthorizationProcedureId =
  | 'PROC-DUAL-AUTH-1011'
  | 'PROC-DUAL-AUTH-1016'
  | 'PROC-PREAUTH-0030'
  | 'PROC-QUICPASS-PURCHASE'
  | 'PROC-SINGLE-FIN-100';

export interface CardAuthorizationParams {
  merchantId:      string;
  terminalId?:     string;
  amount:          number;     // decimal, e.g. 25.00
  currency?:       string;
  protocol:        '101.1' | '101.6';
  cardNumber?:     string;     // 101.1: full PAN; 101.6: masked or omit
  expiry?:         string;     // MMYY
  cvv?:            string | null;
  emvField55?:     string;     // hex — 101.6 only
  stan?:           string;
  customerId?:     string;
  processingCode?: string;     // optional DE3 override (e.g., 003000 for preauth)
  posEntryMode?:   string;     // optional DE22 override
  posCondition?:   string;     // optional DE25 override
  procedureId?:    AuthorizationProcedureId; // explicit procedure selection
  requirePin?:     boolean;    // PIN entry performed (overrides protocol default)
}

export interface CardAuthorizationResult {
  success:       boolean;
  transactionId: string;
  authRef:       string;
  approvalCode:  string;
  responseCode:  string;
  amount:        number;
  currency:      string;
  protocol:      string;
  message?:      string;
  procedureId?:  string;
  brandScheme?:  string;
  mtiRequest?:   string;
  mtiResponse?:  string;
  processingCode?: string;
  posEntryMode?: string;
  posCondition?: string;
  dualMessage?:  boolean;
  requiresCapture?: boolean;
  autoReverseSeconds?: number;
  stepsEmitted?: { order: number; name: string; p2013Code?: string }[];
}

type ProcedureContext = {
  protocolConfig: ReturnType<typeof getProtocolConfig>;
  procedure: ReturnType<typeof getProcedure>;
  brand: ReturnType<typeof detectCardBrand> | undefined;
  brandScheme: string;
  resolvedMti: string;
  resolvedProcessingCode: string;
  resolvedPosEntry: string;
  resolvedPosCondition: string;
};

function resolveAuthorizationProcedure(params: CardAuthorizationParams) {
  if (params.procedureId) {
    const explicit = PROCESSING_PROCEDURES[params.procedureId];
    if (explicit) return explicit;
  }
  const candidates = listProceduresForProtocol(params.protocol);
  if (params.emvField55) {
    const qps = candidates.find(p => p.id === 'PROC-QUICPASS-PURCHASE');
    if (qps) return qps;
    const emv = candidates.find(p => p.id === 'PROC-DUAL-AUTH-1016');
    if (emv) return emv;
  }
  if (params.processingCode && /^0030/.test(params.processingCode)) {
    const pa = candidates.find(p => p.id === 'PROC-PREAUTH-0030');
    if (pa) return pa;
  }
  const defaultProc = candidates.find(p => p.id === (params.protocol === '101.6' ? 'PROC-DUAL-AUTH-1016' : 'PROC-DUAL-AUTH-1011'));
  return defaultProc || candidates[0];
}

async function ensureProcedureEventsTable() {
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
}

async function emitProcedureStep(
  txnId: string,
  procedureId: string,
  step: { order: number; name: string; p2013Code?: string },
  amountMinor: number,
  currency: string,
  meta: Record<string, unknown> = {},
) {
  await ensureProcedureEventsTable();
  await db.query(
    `INSERT INTO procedure_events (id,tx_id,procedure_id,step_order,step_name,p2013_code,amount_minor,currency,status,meta_json,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      uuidv4(), txnId, procedureId, step.order, step.name, step.p2013Code || null,
      amountMinor, currency, 'EMITTED', JSON.stringify(meta), new Date().toISOString(),
    ],
  );
}

export async function authorizeCardTransaction(
  params: CardAuthorizationParams
): Promise<CardAuthorizationResult> {

  const ccy        = String(params.currency || 'USD').toUpperCase().trim();
  const amountMinor = Math.round(params.amount * 100);
  const terminalId = params.terminalId || 'WEB-TERMINAL';
  const stan       = params.stan || String(Date.now()).slice(-6);

  if (!params.merchantId?.trim() || !Number.isFinite(params.amount) || params.amount <= 0
    || !/^[A-Z]{3}$/.test(ccy) || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('Invalid merchant, amount, or currency');
  }

  assertAmountWithinTestCapOrThrow(params.amount, ccy);

  // ── Protocol + Procedure resolution (PDF-sourced tables) ─────────────────
  const protocolConfig = getProtocolConfig(params.protocol);
  if (amountMinor < protocolConfig.minAmountMinor || amountMinor > protocolConfig.maxAmountMinor) {
    throw new Error(
      `Amount ${amountMinor} outside protocol ${params.protocol} limits (${protocolConfig.minAmountMinor}-${protocolConfig.maxAmountMinor})`
    );
  }

  const procedure = resolveAuthorizationProcedure(params);
  if (!procedure) throw new Error(`No processing procedure found for protocol ${params.protocol}`);
  if (!procedure.protocol.includes(params.protocol)) {
    throw new Error(`Procedure ${procedure.id} does not support protocol ${params.protocol}`);
  }

  // ── Brand detection (BIN tables expanded per PDF) ─────────────────────────
  const brand = params.cardNumber ? detectCardBrand(params.cardNumber) : undefined;
  const brandScheme = brand?.scheme || (params.cardNumber ? detectScheme(params.cardNumber) : 'VISA');
  const brandParams = getBrandParams(brandScheme);

  if (brand && procedure.brandScope.length && !procedure.brandScope.includes('ALL') && !procedure.brandScope.includes(brandScheme as any)) {
    throw new Error(`Procedure ${procedure.id} brand scope excludes card scheme ${brandScheme}`);
  }

  // ── DE defaults from protocol config + procedure steps ISO block ──────────
  type StepIsoDefaults = {
    mti?: string;
    processingCode?: string;
    posEntryMode?: string;
    posConditionCode?: string;
  };
  const stepDefaults: StepIsoDefaults = procedure.steps.reduce<StepIsoDefaults>(
    (acc, s) => (s.iso ? { ...acc, ...(s.iso as StepIsoDefaults) } : acc),
    {},
  );
  const resolvedMti =
    (procedure as any).dualMessage
      ? (stepDefaults.mti || MTI.DUAL_AUTH_REQUEST)
      : (stepDefaults.mti || MTI.SINGLE_FINANCIAL_REQUEST);
  const resolvedProcessingCode =
    params.processingCode ||
    stepDefaults.processingCode ||
    protocolConfig.processingCode ||
    PROCESSING_CODES.SALE_GOODS_SERVICES;
  const resolvedPosEntry =
    params.posEntryMode ||
    stepDefaults.posEntryMode ||
    (params.emvField55
      ? (POS_ENTRY_MODES.CHIP_CONTACTLESS_QUICPASS || POS_ENTRY_MODES.CHIP_CONTACT_CUSTOMER_PRESENT)
      : POS_ENTRY_MODES.MAGSTRIPE_MANUAL_KEYED) ||
    protocolConfig.posEntryModeDefault;
  const resolvedPosCondition =
    params.posCondition ||
    stepDefaults.posConditionCode ||
    POS_CONDITION_CODES.NORMAL;

  const ctx: ProcedureContext = {
    protocolConfig,
    procedure,
    brand,
    brandScheme,
    resolvedMti,
    resolvedProcessingCode,
    resolvedPosEntry,
    resolvedPosCondition,
  };

  // ── PAN / EMV presence (per protocol) check ───────────────────────────────
  if (protocolConfig.panRequired && !params.cardNumber) {
    throw new Error(`Protocol ${params.protocol} requires PAN (cardNumber)`);
  }
  if (protocolConfig.emvField55Required && !params.emvField55) {
    throw new Error(`Protocol ${params.protocol} requires EMV field 55`);
  }
  if (protocolConfig.requiresCvv && params.cvv == null && !params.emvField55) {
    throw new Error(`Protocol ${params.protocol} requires CVV`);
  }
  if ((params.requirePin ?? protocolConfig.requiresPin) && !params.emvField55) {
    // PIN block is handled downstream via acquirer client; just flag missing here if explicitly requested
  }

  // ── Union procedure-steps required-field validation (DEs) ────────────────
  const requiredDeNumbers = Array.from(
    new Set(
      (procedure.steps || [])
        .map(s => (s.iso?.requiredFields || []) as number[])
        .reduce<number[]>((acc, arr) => acc.concat(arr), []),
    ),
  ).sort((a, b) => a - b);

  const paramsAsDe: Record<number, string | undefined> = {
    2: params.cardNumber,
    3: resolvedProcessingCode,
    4: String(amountMinor).padStart(12, '0'),
    11: stan,
    14: params.expiry,
    22: resolvedPosEntry,
    25: resolvedPosCondition,
    41: terminalId,
    42: params.merchantId,
    49: brandParams?.applicationCurrencyCode || (ccy === 'USD' ? '840' : ccy === 'EUR' ? '978' : ccy === 'GBP' ? '826' : ''),
    55: params.emvField55,
  };
  const missingDe: number[] = [];
  for (const de of requiredDeNumbers) {
    if (de === 52) continue; // PIN block provided by acquirer client HSM path
    const v = paramsAsDe[de];
    if (v == null || v === '') missingDe.push(de);
  }
  if (missingDe.length) {
    throw new Error(`Procedure ${procedure.id} missing required ISO DEs: ${missingDe.join(',')}`);
  }

  const txnId      = uuidv4();
  const stepsEmitted: { order: number; name: string; p2013Code?: string }[] = [];
  for (const step of (procedure.steps || [])) {
    if ((step as any).iso?.mti) break; // stop at online request step; emit after acquirer
    if (!step.p2013Code && !(step as any).required) continue;
    await emitProcedureStep(txnId, procedure.id, step, amountMinor, ccy, {
      protocol: params.protocol,
      brand: brandScheme,
      terminalId,
      merchantId: params.merchantId,
      customerId: params.customerId || null,
      resolvedIso: {
        mti: resolvedMti,
        processingCode: resolvedProcessingCode,
        posEntry: resolvedPosEntry,
        posCondition: resolvedPosCondition,
      },
    });
    stepsEmitted.push({ order: step.order, name: step.name, p2013Code: (step as any).p2013Code });
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS card_authorizations (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      terminal_id TEXT,
      customer_id TEXT,
      amount REAL NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      protocol TEXT NOT NULL,
      stan TEXT,
      auth_ref TEXT NOT NULL,
      approval_code TEXT,
      response_code TEXT,
      pan_masked TEXT,
      expiry TEXT,
      status TEXT NOT NULL DEFAULT 'AUTHORIZED',
      captured_at TEXT,
      reversed_at TEXT,
      acquirer_raw TEXT,
      created_at TEXT NOT NULL
    )
  `);

  const duplicate = await db.query(
    `SELECT * FROM card_authorizations
      WHERE merchant_id = ? AND terminal_id = ? AND stan = ?
        AND amount_minor = ? AND currency = ? AND created_at >= datetime('now', '-15 minutes')
      ORDER BY created_at DESC
      LIMIT 1`,
    [params.merchantId, terminalId, stan, amountMinor, ccy],
  );
  if (duplicate.rows?.length) {
    const row = duplicate.rows[0];
    const rc = String(row.response_code || (row.status === 'AUTHORIZED' ? '00' : '96'));
    const duplicateApproved = row.status === 'AUTHORIZED' && isApprovalResponse(rc);
    return {
      success: duplicateApproved,
      transactionId: String(row.id),
      authRef: String(row.auth_ref),
      approvalCode: String(row.approval_code || ''),
      responseCode: rc,
      amount: Number(row.amount),
      currency: String(row.currency),
      protocol: String(row.protocol),
      message: 'Duplicate authorization request replayed from stored response',
      procedureId: procedure.id,
      brandScheme,
      mtiRequest: resolvedMti,
      processingCode: resolvedProcessingCode,
      posEntryMode: resolvedPosEntry,
      posCondition: resolvedPosCondition,
      dualMessage: (procedure as any).dualMessage,
      requiresCapture: (procedure as any).requiresCapture,
      autoReverseSeconds: (procedure as any).autoReverseSeconds,
    };
  }

  // ── Check acquirer is configured ────────────────────────────────────────────
  if (!isAcquirerConfigured()) {
    throw new Error(
      'Real acquirer is not configured. Set ACQUIRER_HOST in backend/.env to enable live card authorization.'
    );
  }

  // ── Call acquirer ────────────────────────────────────────────────────────────
  const client  = getAcquirerClient();
  const authRes = await client.authorize({
    merchantAccount: acquirerConfig.merchantId,
    amountMinor,
    currency:        ccy,
    protocol:        params.protocol,
    cardNumber:      params.cardNumber,
    expiry:          params.expiry,
    cvv:             params.cvv,
    emvField55:      params.emvField55,
    stan,
    terminalId:      params.terminalId || 'WEB-TERMINAL',
    posEntryMode:    resolvedPosEntry,
    processingCode:  resolvedProcessingCode,
    posCondition:    resolvedPosCondition,
    mti:             resolvedMti,
  });

  if (!authRes.success) {
    throw new Error(
      `Authorization failed: RC=${authRes.responseCode} — ${authRes.message || 'Declined by acquirer'}`
    );
  }

  if (!authRes.authRef || !authRes.approvalCode) {
    throw new Error('Acquirer did not provide the authorization reference and customer authorization code');
  }

  const authRef = authRes.authRef;
  const approvalCode = authRes.approvalCode;
  const responseRc  = String(authRes.responseCode || '');
  const rcApproved  = isApprovalResponse(responseRc) || authRes.success;

  if (!rcApproved) {
    // Decline: emit error stage step then re-throw
    const errStep = (procedure.steps || []).find(s => (s as any).errorStage) || { order: 99, name: 'Declined' };
    await emitProcedureStep(txnId, procedure.id, errStep, amountMinor, ccy, {
      rc: responseRc,
      message: authRes.message || 'Declined',
      declined: true,
    });
    throw new Error(
      `Authorization failed: RC=${responseRc} — ${authRes.message || 'Declined by acquirer'}`
    );
  }

  // ── Emit post-online steps (RC validate / hold place / store ref) ────────
  for (const step of (procedure.steps || [])) {
    if (!(step as any).iso?.mti && stepsEmitted.some(e => e.order === step.order)) continue;
    await emitProcedureStep(txnId, procedure.id, step, amountMinor, ccy, {
      approvalCode,
      authRef,
      rc: responseRc,
      panLast4: params.cardNumber ? String(params.cardNumber).replace(/\D/g, '').slice(-4) : null,
    });
    stepsEmitted.push({ order: step.order, name: step.name, p2013Code: (step as any).p2013Code });
  }

  // ── Store authorization in DB ─────────────────────────────────────────────
  const now = new Date().toISOString();
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS card_authorizations (
        id               TEXT PRIMARY KEY,
        merchant_id      TEXT NOT NULL,
        terminal_id      TEXT,
        customer_id      TEXT,
        amount           REAL NOT NULL,
        amount_minor     INTEGER NOT NULL,
        currency         TEXT NOT NULL,
        protocol         TEXT NOT NULL,
        stan             TEXT,
        auth_ref         TEXT NOT NULL,
        approval_code    TEXT,
        response_code    TEXT,
        pan_masked       TEXT,
        expiry           TEXT,
        status           TEXT NOT NULL DEFAULT 'AUTHORIZED',
        captured_at      TEXT,
        reversed_at      TEXT,
        acquirer_raw     TEXT,
        created_at       TEXT NOT NULL
      )
    `);

    const panMasked = params.cardNumber
      ? `****${String(params.cardNumber).replace(/\s/g, '').slice(-4)}`
      : '****';

    await db.query(`
      INSERT INTO card_authorizations
        (id, merchant_id, terminal_id, customer_id, amount, amount_minor,
         currency, protocol, stan, auth_ref, approval_code, response_code,
         pan_masked, expiry, status, acquirer_raw, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'AUTHORIZED',?,?)
    `, [
      txnId,
      params.merchantId,
      terminalId,
      params.customerId || null,
      params.amount,
      amountMinor,
      ccy,
      params.protocol,
      stan,
      authRef,
      approvalCode,
      authRes.responseCode,
      panMasked,
      params.expiry || null,
      JSON.stringify(authRes.raw || {}),
      now,
    ]);
  } catch (dbErr: any) {
    console.error('[cardAuthorization] DB store failed:', dbErr.message);
    throw new Error('Authorization succeeded upstream but could not be recorded locally');
  }

  console.log(`[Acquirer] ✅ Auth ${params.protocol} | ${ccy} ${params.amount} | RC=${authRes.responseCode} | Ref=${authRef} | Proc=${procedure.id}`);

  return {
    success:       true,
    transactionId: txnId,
    authRef,
    approvalCode,
    responseCode:  responseRc,
    amount:        params.amount,
    currency:      ccy,
    protocol:      params.protocol,
    message:       authRes.message,
    procedureId:   procedure.id,
    brandScheme,
    mtiRequest:    resolvedMti,
    mtiResponse:   (procedure as any).dualMessage ? MTI.DUAL_AUTH_RESPONSE : MTI.SINGLE_FINANCIAL_RESPONSE,
    processingCode: resolvedProcessingCode,
    posEntryMode:  resolvedPosEntry,
    posCondition:  resolvedPosCondition,
    dualMessage:   (procedure as any).dualMessage,
    requiresCapture: (procedure as any).requiresCapture,
    autoReverseSeconds: (procedure as any).autoReverseSeconds,
    stepsEmitted,
  };
}
