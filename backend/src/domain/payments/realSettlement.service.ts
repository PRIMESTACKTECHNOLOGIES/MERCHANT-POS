import axios from "axios";
import { db } from "../../config/db";
import { v4 as uuidv4 } from "uuid";
import { acquirerConfig } from '../../config/acquirer';
import { createAcquirerClient } from './acquirer';

export async function settleCardTransaction(
  merchantId: string,
  amount: number,
  authRef: string,
  currency: string = 'USD'
) {
  if (!merchantId) throw new Error("merchantId required");
  if (amount <= 0) throw new Error("amount must be positive");
  if (!authRef) throw new Error("authRef required");
  const ccy = String(currency || 'USD').toUpperCase().trim();
  let captureId: string;
  if (acquirerConfig.host) {
    const acquirer = createAcquirerClient();
    const capture = await acquirer.capture({
      merchantAccount: acquirerConfig.merchantAccount || merchantId,
      amountMinor: Math.round(amount * 100),
      currency: ccy,
      authRef,
      protocol: '201.3',
    });
    if (!capture.success) throw new Error(capture.message || `Acquirer capture declined (RC=${capture.responseCode})`);
    captureId = capture.captureRef || authRef;
  } else {
    const captureUrl = process.env.CARD_PROCESSOR_CAPTURE_URL;
    if (!captureUrl) throw new Error("CARD_PROCESSOR_CAPTURE_URL missing");
    const res = await axios.post(
      captureUrl,
      { amount, currency: ccy, authorizationReference: authRef },
      { timeout: 8000 }
    );
    if (!res.data?.success) throw new Error(res.data?.message || "Processor capture failed");
    captureId = res.data.captureId || res.data.id || uuidv4();
  }

  // Get or create merchant wallet for the specific currency
  const walletRes = await db.query(
    "SELECT * FROM merchant_wallets WHERE merchant_id = ? AND currency = ?",
    [merchantId, ccy]
  );
  let wallet = walletRes.rows[0];

  if (!wallet) {
    const id = uuidv4();
    await db.query(
      `INSERT INTO merchant_wallets (id, merchant_id, balance, currency)
       VALUES (?, ?, 0, ?)`,
      [id, merchantId, ccy]
    );
    wallet = (await db.query("SELECT * FROM merchant_wallets WHERE id = ?", [id])).rows[0];
  }

  const txnId = uuidv4();

  // Credit merchant wallet with real settlement
  await db.query(
    "UPDATE merchant_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [amount, wallet.id]
  );

  // Log merchant wallet transaction WITH CURRENCY
  await db.query(
    `INSERT INTO merchant_wallet_transactions
     (id, wallet_id, type, amount, currency, source, reference, description)
     VALUES (?, ?, 'credit', ?, ?, 'card_settlement', ?, ?)`,
    [
      txnId,
      wallet.id,
      amount,
      ccy,
      captureId,
      `Card settlement for auth ${authRef}`
    ]
  );

  // Store settlement record
  await db.query(
    `INSERT INTO settlements
     (id, merchant_id, amount, currency, processor_ref, status)
     VALUES (?, ?, ?, ?, ?, 'COMPLETED')`,
    [uuidv4(), merchantId, amount, ccy, captureId]
  );

  return {
    success: true,
    merchantWalletId: wallet.id,
    transactionId: txnId,
    captureId,
    settledAmount: amount,
    currency: ccy,
  };
}
