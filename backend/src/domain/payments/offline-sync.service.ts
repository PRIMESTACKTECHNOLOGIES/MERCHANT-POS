import { db } from "../../config/db";
import { v4 as uuidv4 } from "uuid";
import { invoiceReceiptService } from "../receipts/invoice-receipt.service";

export async function applyOfflineSaleToWallet(
  customerId: string,
  amount: number,
  sourceRef: string
) {
  const walletRes = await db.query(
    "SELECT * FROM customer_wallets WHERE customer_id = ?",
    [customerId]
  );
  let wallet = walletRes.rows[0];

  if (!wallet) {
    const id = uuidv4();
    const walletCode = `WLT-${Math.floor(Math.random() * 9000) + 1000}`;
    await db.query(
      `INSERT INTO customer_wallets (id, customer_id, balance, currency, wallet_code)
       VALUES (?, ?, 0, 'USD', ?)`,
      [id, customerId, walletCode]
    );
    wallet = (await db.query("SELECT * FROM customer_wallets WHERE id = ?", [id])).rows[0];
  }

  const txnId = uuidv4();

  await db.query(
    `UPDATE customer_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [amount, wallet.id]
  );

  await db.query(
    `INSERT INTO wallet_transactions (id, wallet_id, type, amount, source, reference, description)
     VALUES (?, ?, 'credit', ?, 'offline_pos', ?, ?)`,
    [txnId, wallet.id, amount, sourceRef, `Offline POS sale ${sourceRef}`]
  );

  return { success: true, walletId: wallet.id, transactionId: txnId };
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
  if (!customerId?.trim()) {
    throw new Error('customerId is required for provider-captured offline wallet funding');
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
      cardBrand || null,
      readerSource || null,
      cvmResult || null,
      pinVerified ? 1 : 0,
      rrn || null,
      authCode || null,
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
    merchantId, amount, currency: currencyCode, status: 'PENDING', reference: rrn || stan || txnId,
    description: 'Offline POS transaction invoice',
    details: { terminalId: terminalId || 'UNKNOWN', batchId, localTxnId: localId, stan, rrn, authCode },
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
        rrn,
        authCode,
        tlvRaw,
        emvData,
        source: 'offline_pin',
      }),
      txnTimestamp,
      txnTimestamp,
    ]
  );

  const settlementId = uuidv4();
  const settlementMeta = JSON.stringify({
    stan: stan || null,
    rrn: rrn || null,
    auth_code: authCode || null,
    auth_ref: authCode || null,
    card_masked: panMasked || null,
    entry_mode: entryMode,
    auth_mode: authMode,
    cvm_result: cvmResult || null,
    pin_verified: pinVerified,
    emv_data: emvData || null,
    tlv_raw: tlvRaw || null,
    local_txn_id: localId,
    batch_id: batchId,
    terminal_id: terminalId || null,
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
