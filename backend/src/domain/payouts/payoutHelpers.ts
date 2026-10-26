import { db } from '../../config/db';
import { walletsService } from '../wallets/wallets.service';
import { v4 as uuidv4 } from 'uuid';
import { createLedgerEntry, validateTransition, persistLedgerEntry } from '../ledger/ledger.service';

export async function debitMerchantWallet(merchantId: string, amount: number, reason: string, reference?: string, meta?: any, currency: string = 'USD') {
  if (amount <= 0) throw new Error('Amount must be positive');

  // Use explicit transaction
  await db.query('BEGIN IMMEDIATE');
  try {
    // Debit the wallet for the payout currency — a merchant holding EUR must not
    // have the debit taken from the USD wallet.
    const wallet = await walletsService.getOrCreateMerchantWallet(merchantId, currency);
    const ccy = String(wallet.currency || currency || 'USD').toUpperCase();

    const balRes = await db.query('SELECT balance FROM merchant_wallets WHERE id = ?', [wallet.id]);
    const balance = Number(balRes.rows[0]?.balance ?? 0);
    if (balance < amount) {
      await db.query('ROLLBACK');
      throw new Error(`Insufficient balance: merchant has ${balance.toFixed(2)} ${ccy}, needs ${Number(amount).toFixed(2)} ${ccy}`);
    }

    await db.query('UPDATE merchant_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [amount, wallet.id]);

    // ledger entry
    const txnId = uuidv4();
    const ledgerEntry = createLedgerEntry(txnId, 'debit', amount, ccy, 'AUTHORIZED', reason || 'merchant_payout');
    validateTransition('PENDING', ledgerEntry.status as any);
    await persistLedgerEntry(ledgerEntry, db.query.bind(db));

    await db.query('COMMIT');
    return { success: true, transactionId: txnId };
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (err) { /* ignore */ }
    throw e;
  }
}

/** Reverse a prior debit (e.g. when external network payout fails) — mirrors debitMerchantWallet. */
export async function creditMerchantWallet(merchantId: string, amount: number, reason: string, reference?: string, meta?: any, currency: string = 'USD') {
  if (amount <= 0) throw new Error('Amount must be positive');
  await db.query('BEGIN IMMEDIATE');
  try {
    const wallet = await walletsService.getOrCreateMerchantWallet(merchantId, currency);
    const ccy = String(wallet.currency || currency || 'USD').toUpperCase();
    await db.query('UPDATE merchant_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [amount, wallet.id]);
    const txnId = uuidv4();
    const ledgerEntry = createLedgerEntry(txnId, 'credit', amount, ccy, 'AUTHORIZED', reason || 'merchant_payout_reversal');
    validateTransition('PENDING', ledgerEntry.status as any);
    await persistLedgerEntry(ledgerEntry, db.query.bind(db));
    await db.query('COMMIT');
    return { success: true, transactionId: txnId };
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (err) { /* ignore */ }
    throw e;
  }
}

export default { debitMerchantWallet, creditMerchantWallet };
