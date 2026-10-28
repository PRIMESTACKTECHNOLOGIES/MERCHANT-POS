import axios from "axios";
import { db } from "../../config/db";
import { v4 as uuidv4 } from "uuid";

export async function bankPayout(
  customerId: string,
  bankAccountId: string,
  amount: number
) {
  if (!customerId) throw new Error("customerId required");
  if (!bankAccountId) throw new Error("bankAccountId required");
  if (amount <= 0) throw new Error("amount must be positive");

  // Get wallet
  const walletRes = await db.query(
    "SELECT * FROM customer_wallets WHERE customer_id = ?",
    [customerId]
  );
  const wallet = walletRes.rows[0];
  if (!wallet) throw new Error("Wallet not found");

  // Check balance
  const balRes = await db.query(
    "SELECT balance FROM customer_wallets WHERE id = ?",
    [wallet.id]
  );
  const balance = Number(balRes.rows[0]?.balance ?? 0);
  if (balance < amount) throw new Error("Insufficient wallet balance");

  // Get bank account
  const bankRes = await db.query(
    "SELECT * FROM bank_accounts WHERE id = ? AND customer_id = ?",
    [bankAccountId, customerId]
  );
  const bank = bankRes.rows[0];
  if (!bank) throw new Error("Bank account not found");

  // Generate payout ID + reference
  const payoutId = uuidv4();
  const reference = `PAY-${payoutId.slice(0, 8).toUpperCase()}`;

  // Debit wallet
  await db.query(
    "UPDATE customer_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [amount, wallet.id]
  );

  // Log wallet transaction
  await db.query(
    `INSERT INTO wallet_transactions
     (id, wallet_id, type, amount, source, reference, description)
     VALUES (?, ?, 'debit', ?, 'bank_payout', ?, ?)`,
    [
      uuidv4(),
      wallet.id,
      amount,
      reference,
      `Bank payout to ${bank.bank_name}`
    ]
  );

  // Wise payout API endpoint
  const wiseUrl = process.env.WISE_PAYOUT_URL;
  if (!wiseUrl) throw new Error("WISE_PAYOUT_URL missing");

  // Call Wise API
  const wiseRes = await axios.post(
    wiseUrl,
    {
      amount,
      currency: bank.currency || "EUR",
      recipientName: bank.account_holder,
      iban: bank.iban,
      swift: bank.swift_code,
      reference
    },
    { timeout: 10000 }
  );

  if (!wiseRes.data?.id) {
    throw new Error(wiseRes.data?.message || "Wise payout failed");
  }

  const providerRef = wiseRes.data.id;

  // Store payout record
  await db.query(
    `INSERT INTO bank_payouts
     (id, customer_id, bank_account_id, amount, currency, fee, net_amount,
      status, reference, provider_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payoutId,
      customerId,
      bankAccountId,
      amount,
      bank.currency || "EUR",
      0,
      amount,
      "PENDING",
      reference,
      providerRef
    ]
  );

  return {
    success: true,
    payoutId,
    reference,
    providerRef,
    amount,
    status: "PENDING"
  };
}
