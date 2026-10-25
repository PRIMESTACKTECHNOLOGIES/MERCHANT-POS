import axios from "axios";
import { db } from "../../config/db";
import { v4 as uuidv4 } from "uuid";

export async function createBankPayout(
  customerId: string,
  bankAccountId: string,
  amount: number
) {
  if (amount <= 0) throw new Error("Amount must be positive");

  const walletRes = await db.query(
    "SELECT * FROM customer_wallets WHERE customer_id = ?",
    [customerId]
  );
  const wallet = walletRes.rows[0];
  if (!wallet) throw new Error("Wallet not found");

  const balRes = await db.query(
    "SELECT balance FROM customer_wallets WHERE id = ?",
    [wallet.id]
  );
  const balance = Number(balRes.rows[0]?.balance ?? 0);
  if (balance < amount) throw new Error("Insufficient wallet balance");

  const bankRes = await db.query(
    "SELECT * FROM bank_accounts WHERE id = ? AND customer_id = ?",
    [bankAccountId, customerId]
  );
  const bank = bankRes.rows[0];
  if (!bank) throw new Error("Bank account not found");

  const payoutId = uuidv4();
  const ref = `PAY-${payoutId.slice(0, 8).toUpperCase()}`;

  // Debit wallet
  await db.query(
    "UPDATE customer_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [amount, wallet.id]
  );
  await db.query(
    `INSERT INTO wallet_transactions (id, wallet_id, type, amount, source, reference, description)
     VALUES (?, ?, 'debit', ?, 'bank_payout', ?, ?)`,
    [uuidv4(), wallet.id, amount, ref, `Bank payout to ${bank.bank_name}`]
  );

  // Call the configured bank payout API
  const bankPayoutUrl = process.env.PAYOUT_BANK_API_URL;
  if (!bankPayoutUrl) throw new Error("Bank payout API URL missing (PAYOUT_BANK_API_URL)");

  const payoutRes = await axios.post(
    bankPayoutUrl,
    {
      amount,
      currency: bank.currency || "EUR",
      recipientName: bank.account_holder,
      iban: bank.iban,
      swift: bank.swift_code,
      reference: ref,
    },
    { timeout: 10000 }
  );

  if (!payoutRes.data?.id) {
    throw new Error(payoutRes.data?.message || "Payout creation failed");
  }

  const providerRef = payoutRes.data.id;

  await db.query(
    `INSERT INTO bank_payouts (id, customer_id, bank_account_id, amount, currency, fee, net_amount, status, reference, provider_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [payoutId, customerId, bankAccountId, amount, bank.currency || "EUR", 0, amount, "PENDING", ref, providerRef]
  );

  return { success: true, payoutId, reference: ref, providerRef };
}
