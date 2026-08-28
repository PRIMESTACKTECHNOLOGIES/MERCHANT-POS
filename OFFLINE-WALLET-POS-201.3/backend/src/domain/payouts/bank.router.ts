import { Router } from 'express';
import { debitMerchantWallet } from './payoutHelpers';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import { submitBankPayout } from './payoutProvider.service';

const router = Router();

// POST /api/merchant/:merchantId/payout/bank
router.post('/merchant/:merchantId/payout/bank', async (req, res) => {
  const { merchantId } = req.params as any;
  const { amount, bank_account } = req.body;

  if (!amount || amount <= 0 || !bank_account) return res.status(400).json({ error: 'Invalid payload' });

  const payoutProvider = process.env.BANK_PAYOUT_PROVIDER?.trim().toLowerCase();
  const payoutApiUrl = process.env.BANK_PAYOUT_API_URL?.trim();
  const payoutApiKey = process.env.BANK_PAYOUT_API_KEY?.trim() || process.env.WISE_API_KEY?.trim();

  if (payoutProvider !== 'external' || !payoutApiUrl || !payoutApiKey) {
    return res.status(501).json({
      error: 'Bank payout is not enabled for production. Configure BANK_PAYOUT_PROVIDER=external, BANK_PAYOUT_API_URL, and BANK_PAYOUT_API_KEY/WISE_API_KEY with a real payout provider endpoint.'
    });
  }

  try {
    // Debit merchant wallet (includes ledger)
    await debitMerchantWallet(merchantId, Number(amount), 'payout', 'bank_payout', { bank_account });

    const payoutId = uuidv4();
    await db.query(
      `INSERT INTO merchant_payouts (id, merchant_id, amount, currency, bank_account, status, meta) VALUES (?, ?, ?, 'USD', ?, 'pending', ?)`,
      [payoutId, merchantId, amount, bank_account, JSON.stringify({ requested_by: 'admin' })]
    );

    const payoutResult = await submitBankPayout({
      merchantId,
      payoutId,
      amount: Number(amount),
      currency: 'USD',
      bankAccount: bank_account,
      reference: payoutId,
    });

    await db.query(
      `UPDATE merchant_payouts SET status = ?, provider_reference = ?, meta = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [payoutResult.status || 'submitted', payoutResult.providerReference || null, JSON.stringify({ provider: payoutResult.provider, raw: payoutResult.raw }), payoutId]
    );

    res.json({ ok: true, payout_id: payoutId, status: payoutResult.status || 'submitted', provider: payoutResult.provider, provider_reference: payoutResult.providerReference, message: 'Bank payout request submitted to live provider.' });
  } catch (e: any) {
    console.error('Bank payout error', e);
    res.status(400).json({ error: e.message });
  }
});

export default router;
