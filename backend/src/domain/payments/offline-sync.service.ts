import { db } from "../../config/db";
import { v4 as uuidv4 } from "uuid";
import { invoiceReceiptService } from "../receipts/invoice-receipt.service";
import { generateRRN, detectCardBrand, generateAuthCode } from "./transaction-identity";
import { syncOfflinePreflight } from "./offline-decline-preflight";
import { getAcquirerClient } from "../../services/acquirer/HttpAcquirerClient";
import { acquirerConfig, isAcquirerConfigured } from "../../config/acquirer";

/**
 * Settlement lifecycle.
 *
 * The DB `status` column of merchant_pos_settlements only distinguishes
 * 'unsettled' from 'settled' — the reconciliation engine
 * (settlementReconciliation.service.getUnsettledLocalSettlements) queries on
 * exactly those two values, so intermediate states MUST NOT be written there or
 * a settlement in flight would silently drop out of reconciliation.
 *
 * The full lifecycle is therefore tracked in meta.settlement_status, and the
 * `status` column is flipped to 'settled' only once the money is in the wallet.
 */
export enum SettlementStatus {
  PENDING = 'pending',
  AUTHORIZING = 'authorizing',
  AUTHORIZED = 'authorized',
  CAPTURING = 'capturing',
  CAPTURED = 'captured',
  WALLET_FUNDED = 'wallet_funded',
  SETTLED = 'settled',
  FAILED = 'failed',
}

function safeParseJsonObject(raw: unknown): Record<string, any> {
  if (raw && typeof raw === 'object') return raw as Record<string, any>;
  try {
    const parsed = JSON.parse(String(raw || ''));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Fund a customer wallet from a captured offline sale.
 *
 * Idempotent, transactional and audit-linked:
 *   - the whole thing runs in one BEGIN IMMEDIATE … COMMIT, so a crash can never
 *     leave a credited wallet without its ledger row (or vice versa);
 *   - a repeated `sourceRef` returns the original transaction instead of
 *     crediting a second time — the settlement worker may retry freely;
 *   - the ledger row carries `settlement_id`, which is what makes the credit
 *     traceable back to the acquirer capture that funded it.
 *
 * NOTE: sql.js (this project's DB) is a single in-process SQLite instance with
 * no connection pool and no row-level locking, so there is no `getConnection()`
 * or `FOR UPDATE` here. `BEGIN IMMEDIATE` takes the write lock for the whole
 * block, which is the equivalent guarantee.
 */
export async function applyOfflineSaleToWallet(
  customerId: string,
  amount: number,
  sourceRef: string,
  settlementId?: string,
  currency: string = 'USD',
): Promise<{
  success: true;
  duplicate: boolean;
  walletId?: string;
  transactionId: string;
}> {
  const currencyCode = (currency || 'USD').toUpperCase();

  await db.query('BEGIN IMMEDIATE');
  try {
    // ── Idempotency: one credit per source reference, ever ──────────────────
    const existing = await db.query(
      `SELECT id, wallet_id FROM wallet_transactions
        WHERE reference = ? AND type = 'credit' LIMIT 1`,
      [sourceRef],
    );
    if (existing.rows.length > 0) {
      await db.query('COMMIT');
      return {
        success: true,
        duplicate: true,
        walletId: existing.rows[0].wallet_id ?? undefined,
        transactionId: existing.rows[0].id,
      };
    }

    // ── Wallet (customer_wallets is UNIQUE on (customer_id, currency)) ──────
    let wallet = (await db.query(
      `SELECT * FROM customer_wallets WHERE customer_id = ? AND currency = ? LIMIT 1`,
      [customerId, currencyCode],
    )).rows[0];

    if (!wallet) {
      const walletId = uuidv4();
      const walletCode = `WLT-${Math.floor(100000 + Math.random() * 900000)}`;
      await db.query(
        `INSERT INTO customer_wallets (id, customer_id, balance, currency, wallet_code)
         VALUES (?, ?, 0, ?, ?)`,
        [walletId, customerId, currencyCode, walletCode],
      );
      wallet = { id: walletId };
    }

    const walletTxnId = uuidv4();

    await db.query(
      `UPDATE customer_wallets
          SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [amount, wallet.id],
    );

    await db.query(
      `INSERT INTO wallet_transactions
         (id, wallet_id, customer_id, type, amount, currency, source, reference, settlement_id, description)
       VALUES (?, ?, ?, 'credit', ?, ?, 'offline_pos', ?, ?, ?)`,
      [
        walletTxnId,
        wallet.id,
        customerId,
        amount,
        currencyCode,
        sourceRef,
        settlementId || null,
        `Offline POS Settlement ${sourceRef}`,
      ],
    );

    if (settlementId) {
      await db.query(
        `UPDATE merchant_pos_settlements
            SET status = 'settled',
                settled_at = COALESCE(settled_at, CURRENT_TIMESTAMP),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status != 'settled'`,
        [settlementId],
      );
    }

    await db.query('COMMIT');
    return { success: true, duplicate: false, walletId: wallet.id, transactionId: walletTxnId };
  } catch (error) {
    try {
      await db.query('ROLLBACK');
    } catch {
      /* keep the original error */
    }
    throw error;
  }
}

export interface OfflinePosTransactionParams {
  merchantId: string;
  customerId?: string;
  terminalId?: string;
  amountMinor: number;
  currency?: string;
  panMasked?: string;
  txnType?: string;
  authMode?: string;
  entryMode?: string;
  cardBrand?: string;
  readerSource?: string;
  cvmResult?: string;
  pinVerified?: boolean;
  rrn?: string;
  stan?: string;
  authCode?: string;
  tokenReference?: string;
  panSequence?: string;
  posConditionCode?: string;
  isoMti?: string;
  isoResponseCode?: string;
  emvData?: Record<string, unknown> | string;
  tlvRaw?: string;
  ledgerEntryId?: string | null;
  localTxnId?: string;
}

export async function recordOfflinePosTransaction(params: OfflinePosTransactionParams) {
  const {
    merchantId,
    customerId,
    terminalId,
    amountMinor,
    currency = 'USD',
    panMasked,
    txnType = 'SALE',
    authMode = 'OFFLINE_APPROVED',
    entryMode = 'CHIP',
    cardBrand,
    readerSource,
    cvmResult,
    pinVerified = false,
    rrn,
    stan,
    authCode,
    tokenReference,
    panSequence,
    posConditionCode,
    isoMti,
    isoResponseCode,
    emvData,
    tlvRaw,
    ledgerEntryId,
    localTxnId,
  } = params;

  const txnId = uuidv4();
  const batchId = `OFFLINE-${uuidv4()}`;
  const txnTimestamp = new Date().toISOString();
  const localId = localTxnId || `LOCAL-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
  const amount = Number(amountMinor) / 100;
  const currencyCode = (currency || 'USD').toUpperCase();
  // Auto-generate RRN, card brand, and auth code when the caller does not supply them
  // so every persisted transaction carries a complete audit identity.
  const resolvedRrn       = rrn || generateRRN();
  const resolvedCardBrand = cardBrand || detectCardBrand(panMasked) || null;
  const resolvedAuthCode  = authCode || generateAuthCode();
  if (!customerId?.trim()) {
    throw new Error('customerId is required for provider-captured offline wallet funding');
  }

  // ── HARD DECLINE PREFLIGHT ───────────────────────────────────────────────
  //  This endpoint is public and unauthenticated, so this is the only place the
  //  offline-PIN path can be screened at all. Without it a magnetic-stripe/MSD
  //  entry mode would be recorded here with no downgrade check and no issuer-AAC
  //  check — exactly the bypass a contactless clone relies on.
  const emvForPreflight: Record<string, unknown> = {
    ...(emvData && typeof emvData === 'object' ? (emvData as Record<string, unknown>) : {}),
  };
  const tlvForPreflight = tlvRaw || (typeof emvData === 'string' ? emvData : '');
  if (tlvForPreflight) emvForPreflight.tlvRaw = tlvForPreflight;

  const preflight = syncOfflinePreflight({
    amountMinor,
    currency: currencyCode,
    // Only a value long enough to be a PAN is offered; the '****' placeholder
    // would fail the length check and decline every transaction.
    pan: panMasked && panMasked.length >= 13 ? panMasked : undefined,
    emv: emvForPreflight,
    terminalId,
    merchantId,
    stan: stan || undefined,
    entryMode: entryMode || undefined,
    // Reaching this function means an offline approval is being recorded, so the
    // offline-disallowed rules do apply.
    allowOfflineApproval: true,
  });

  if (preflight.declined) {
    return {
      success: false as const,
      declined: true as const,
      declineCode: preflight.code,
      declineReason: preflight.reason,
    };
  }

  await db.query(
    `INSERT INTO pos2013_transactions
      (id, merchant_id, customer_id, terminal_id, batch_id, local_txn_id, stan,
       amount_minor, currency, pan_masked, txn_type, auth_mode,
       entry_mode, card_brand, reader_source, cvm_result, pin_verified,
       rrn, auth_code, status, emv_data, emv_field55_hex, token_reference,
       pan_sequence, pos_condition_code, iso_mti, iso_response_code,
       txn_timestamp, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
    [
      txnId,
      merchantId,
      customerId,
      terminalId || 'UNKNOWN',
      batchId,
      localId,
      stan || `000000`,
      amountMinor,
      currencyCode,
      panMasked || '****',
      txnType,
      authMode,
      entryMode,
      resolvedCardBrand,
      readerSource || null,
      cvmResult || null,
      pinVerified ? 1 : 0,
      resolvedRrn,
      resolvedAuthCode,
      typeof emvData === 'string' ? emvData : emvData ? JSON.stringify(emvData) : null,
      tlvRaw || null,
      tokenReference || null,
      panSequence || null,
      posConditionCode || null,
      isoMti || null,
      isoResponseCode || null,
      txnTimestamp,
      txnTimestamp,
    ]
  );

  await invoiceReceiptService.create({
    type: 'POS_INVOICE', sourceTable: 'pos2013_transactions', sourceId: txnId,
    merchantId, amount, currency: currencyCode, status: 'PENDING', reference: resolvedRrn || stan || txnId,
    description: 'Offline POS transaction invoice',
    details: { terminalId: terminalId || 'UNKNOWN', batchId, localTxnId: localId, stan, rrn: resolvedRrn, authCode: resolvedAuthCode },
  });

  await db.query(
    `INSERT INTO offline_funds_receipts
      (id, merchant_id, terminal_id, transaction_id, stan, amount_minor, currency, status, receipt_payload, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
    [
      uuidv4(),
      merchantId,
      terminalId || 'UNKNOWN',
      txnId,
      stan || null,
      amountMinor,
      currencyCode,
      JSON.stringify({
        transactionId: txnId,
        merchantId,
        customerId,
        terminalId,
        batchId,
        localTxnId: localId,
        stan,
        rrn: resolvedRrn,
        authCode: resolvedAuthCode,
        tlvRaw,
        emvData,
        source: 'offline_pin',
      }),
      txnTimestamp,
      txnTimestamp,
    ]
  );

  const settlementId = uuidv4();
  // Reconciliation (settlementReconciliation.findMatchingLocalSettlement) matches
  // on meta.rrn / meta.stan / meta.auth_ref / meta.local_txn_id, so those keys and
  // their names must not change. transaction_id + customer_id are what let the
  // settlement worker fund the right wallet without re-reading the receipt.
  const settlementMeta = JSON.stringify({
    stan: stan || null,
    rrn: resolvedRrn,
    auth_code: resolvedAuthCode,
    auth_ref: resolvedAuthCode,
    transaction_id: txnId,
    customer_id: customerId,
    card_masked: panMasked || null,
    card_brand: resolvedCardBrand,
    amount_minor: amountMinor,
    currency: currencyCode,
    entry_mode: entryMode,
    auth_mode: authMode,
    cvm_result: cvmResult || null,
    pin_verified: pinVerified,
    emv_data: emvData || null,
    tlv_raw: tlvRaw || null,
    local_txn_id: localId,
    batch_id: batchId,
    terminal_id: terminalId || null,
    // ── Acquirer fields, populated by processPendingSettlement on capture ──
    settlement_status: SettlementStatus.PENDING,
    acquirer_name: null,
    acquirer_auth_ref: null,
    acquirer_capture_ref: null,
    acquirer_response_code: null,
  });

  await db.query(
    `INSERT INTO merchant_pos_settlements
      (id, merchant_id, ledger_entry_id, amount, currency, status, created_at, updated_at, meta)
    VALUES (?, ?, ?, ?, ?, 'unsettled', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)`,
    [
      settlementId,
      merchantId,
      ledgerEntryId || null,
      amount,
      currencyCode,
      settlementMeta,
    ]
  );

  return {
    success: true,
    transactionId: txnId,
    settlementId,
    ledgerEntryId,
  };
}

// ── Settlement worker ────────────────────────────────────────────────────────

export interface PendingSettlement {
  id: string;
  merchantId: string;
  customerId: string | null;
  amount: number;
  currency: string;
  status: string;
  meta: Record<string, any>;
}

export async function getSettlement(settlementId: string): Promise<PendingSettlement | null> {
  const res = await db.query(
    `SELECT id, merchant_id, amount, currency, status, meta
       FROM merchant_pos_settlements WHERE id = ? LIMIT 1`,
    [settlementId],
  );
  const row = res.rows?.[0];
  if (!row) return null;

  const meta = safeParseJsonObject(row.meta);
  return {
    id: String(row.id),
    merchantId: String(row.merchant_id),
    customerId: typeof meta.customer_id === 'string' && meta.customer_id ? meta.customer_id : null,
    amount: Number(row.amount),
    currency: String(row.currency || 'USD'),
    status: String(row.status || 'unsettled'),
    meta,
  };
}

/**
 * Move a settlement one step along its lifecycle.
 *
 * meta.settlement_status carries the fine-grained state; the `status` column is
 * flipped to 'settled' only at the terminal step, because the reconciliation
 * engine only understands 'unsettled' | 'settled'.
 */
async function setSettlementStatus(
  settlementId: string,
  status: SettlementStatus,
  patch: Record<string, unknown> = {},
): Promise<void> {
  const pairs: string[] = [`'$.settlement_status', ?`];
  const params: any[] = [status];
  for (const [key, value] of Object.entries(patch)) {
    const safeKey = key.replace(/[^A-Za-z0-9_]/g, '');
    if (!safeKey) continue;
    pairs.push(`'$.${safeKey}', ?`);
    params.push(value === undefined ? null : value);
  }

  const isTerminal = status === SettlementStatus.SETTLED;
  await db.query(
    `UPDATE merchant_pos_settlements
        SET meta = JSON_SET(COALESCE(meta, '{}'), ${pairs.join(', ')}),
            status = CASE WHEN ? THEN 'settled' ELSE status END,
            settled_at = CASE WHEN ? THEN COALESCE(settled_at, CURRENT_TIMESTAMP) ELSE settled_at END,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [...params, isTerminal ? 1 : 0, isTerminal ? 1 : 0, settlementId],
  );
}

/**
 * Capture a pending offline settlement at the acquirer and fund the wallet.
 *
 *   CAPTURING → CAPTURED → WALLET_FUNDED → SETTLED      (success)
 *   CAPTURING → FAILED                                  (acquirer declined)
 *
 * THIS WORKER PERFORMS THE CAPTURE LEG ONLY — deliberately, and not because the
 * authorize leg was forgotten.
 *
 * An offline POS sale stores no PAN (only the mask), and PCI forbids storing the
 * PAN that a fresh `authorize()` would need, so the authorization cannot be
 * replayed here from the settlement row. Real store-and-forward POS works the
 * other way round: the terminal obtains an acquirer reference at the point of
 * sale — the "offline capture token" — carries it in the transaction, and the
 * host captures against that reference when connectivity returns. That reference
 * is `meta.acquirer_auth_ref`. With no reference there is nothing to capture, so
 * the settlement is failed rather than funded with fabricated money.
 */
export async function processPendingSettlement(settlementId: string): Promise<{
  settlementId: string;
  captureRef?: string;
  duplicate: boolean;
  walletTransactionId: string;
}> {
  const settlement = await getSettlement(settlementId);
  if (!settlement) throw new Error(`Settlement ${settlementId} not found`);

  if (!isAcquirerConfigured()) {
    throw new Error(
      'Real acquirer is not configured. Set PSP_BASE_URL (or ACQUIRER_HOST) in backend/.env to enable live capture.',
    );
  }

  const authRef = String(settlement.meta.acquirer_auth_ref || '').trim();
  if (!authRef) {
    await setSettlementStatus(settlementId, SettlementStatus.FAILED, {
      failure_reason: 'NO_ACQUIRER_AUTH_REF',
      failure_detail:
        'Offline sale carried no acquirer auth reference, so no capture is possible and no real funds can be collected.',
    });
    throw new Error(`Settlement ${settlementId} has no acquirer_auth_ref — cannot capture real funds`);
  }

  if (!settlement.customerId) {
    await setSettlementStatus(settlementId, SettlementStatus.FAILED, {
      failure_reason: 'NO_CUSTOMER_ID',
      failure_detail: 'Settlement meta carries no customer_id, so there is no wallet to fund.',
    });
    throw new Error(`Settlement ${settlementId} has no customer_id in meta`);
  }

  const acquirerName = acquirerConfig.pspBaseUrl ? 'psp' : 'vault-bank';

  await setSettlementStatus(settlementId, SettlementStatus.CAPTURING, {
    acquirer_name: acquirerName,
  });

  const capture = await getAcquirerClient().capture({
    merchantAccount: acquirerConfig.merchantId || acquirerConfig.merchantAccount || '',
    amountMinor: Math.round(settlement.amount * 100),
    currency: settlement.currency,
    authRef,
    protocol: '201.3',
    stan: settlement.meta.stan || undefined,
    terminalId: settlement.meta.terminal_id || undefined,
  });

  if (!capture.success) {
    await setSettlementStatus(settlementId, SettlementStatus.FAILED, {
      acquirer_response_code: capture.responseCode,
      failure_reason: 'CAPTURE_DECLINED',
      failure_detail: capture.message || 'Acquirer declined the capture',
    });
    throw new Error(`Capture failed for settlement ${settlementId}: ${capture.message || capture.responseCode}`);
  }

  await setSettlementStatus(settlementId, SettlementStatus.CAPTURED, {
    acquirer_capture_ref: capture.captureRef ?? null,
    acquirer_response_code: capture.responseCode,
    captured_at: new Date().toISOString(),
  });

  // Idempotent on the settlement id, so a retry after a crash cannot double-credit.
  const funded = await applyOfflineSaleToWallet(
    settlement.customerId,
    settlement.amount,
    settlement.id,
    settlement.id,
    settlement.currency,
  );

  await setSettlementStatus(settlementId, SettlementStatus.WALLET_FUNDED, {
    wallet_id: funded.walletId ?? null,
    wallet_transaction_id: funded.transactionId,
    funded_at: new Date().toISOString(),
  });
  await setSettlementStatus(settlementId, SettlementStatus.SETTLED);

  return {
    settlementId,
    captureRef: capture.captureRef,
    duplicate: funded.duplicate,
    walletTransactionId: funded.transactionId,
  };
}
