import { db } from "../../config/db";
import { v4 as uuidv4 } from "uuid";

export async function offlineMerchantCredit(
  merchantId: string,
  amount: number,
  posRef: string,
  currency: string = 'USD'
) {
  if (!merchantId) throw new Error("merchantId required");
  if (amount <= 0) throw new Error("amount must be positive");
  const ccy = (currency || 'USD').toString().toUpperCase().trim();

  // Get or create merchant wallet for the actual transaction currency
  const res = await db.query(
    "SELECT * FROM merchant_wallets WHERE merchant_id = ? AND currency = ?",
    [merchantId, ccy]
  );
  let wallet = res.rows[0];

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

  // Credit merchant wallet
  await db.query(
    `UPDATE merchant_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [amount, wallet.id]
  );

  // Log merchant wallet transaction
  await db.query(
    `INSERT INTO merchant_wallet_transactions
     (id, wallet_id, type, amount, source, reference, description)
     VALUES (?, ?, 'credit', ?, 'offline_pos', ?, ?)`,
    [
      txnId,
      wallet.id,
      amount,
      posRef,
      `Offline POS sale ${posRef}`
    ]
  );

  return {
    success: true,
    merchantWalletId: wallet.id,
    transactionId: txnId,
    credited: amount
  };
}
