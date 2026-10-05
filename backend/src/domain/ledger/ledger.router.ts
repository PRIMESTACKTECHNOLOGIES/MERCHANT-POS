import { Router, Request, Response } from 'express';
import { db } from '../../config/db';
import { authenticateToken } from '../../middleware/auth.middleware';
import { balancedLedgerEngine, ledgerService } from './ledger.service';

const router = Router();

router.get('/transactions/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const txR = await db.query(
      `SELECT * FROM ledger_transactions WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!txR.rows?.length) return res.status(404).json({ error: 'Ledger transaction not found', id });
    const entriesR = await db.query(
      `SELECT id, account_code, type, amount, currency, status, merchant_id, source_type, source_reference,
              reference, description, created_at
         FROM ledger_entries WHERE ledger_transaction_id = ? ORDER BY created_at ASC`,
      [id]
    );
    const entries = (entriesR.rows || []).map((e: any) => ({
      ...e,
      amount: Number(e.amount),
      direction: e.type,
    }));
    const debits = entries.filter((e: any) => (e.direction || e.type) === 'debit').reduce((s: number, e: any) => s + e.amount, 0);
    const credits = entries.filter((e: any) => (e.direction || e.type) === 'credit').reduce((s: number, e: any) => s + e.amount, 0);
    return res.json({
      ...txR.rows[0],
      amount: Number(txR.rows[0].amount),
      metadata: txR.rows[0].metadata ? (() => { try { return JSON.parse(txR.rows[0].metadata); } catch { return null; } })() : null,
      entries,
      debits_sum: debits,
      credits_sum: credits,
      balanced: Math.abs(debits - credits) < 0.0001,
      entries_count: entries.length,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

router.get('/transactions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { type, status, merchant_id, linked_payout_id, linked_batch_id, reference, limit, offset } = req.query as any;
    const conds: string[] = [];
    const args: any[] = [];
    if (type) { conds.push('type = ?'); args.push(type); }
    if (status) { conds.push('status = ?'); args.push(status); }
    if (merchant_id) { conds.push('merchant_id = ?'); args.push(merchant_id); }
    if (linked_payout_id) { conds.push('linked_payout_id = ?'); args.push(linked_payout_id); }
    if (linked_batch_id) { conds.push('linked_batch_id = ?'); args.push(linked_batch_id); }
    if (reference) { conds.push('reference LIKE ?'); args.push(`%${reference}%`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const lim = Math.min(Number(limit || 200), 2000);
    const off = Number(offset || 0);
    const countR = await db.query(`SELECT COUNT(*) c FROM ledger_transactions ${where}`, args);
    const rowsR = await db.query(
      `SELECT * FROM ledger_transactions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...args, lim, off]
    );
    return res.json({
      count: Number(countR.rows?.[0]?.c || 0),
      limit: lim,
      offset: off,
      transactions: (rowsR.rows || []).map((r: any) => ({
        ...r,
        amount: Number(r.amount),
        metadata: r.metadata ? (() => { try { return JSON.parse(r.metadata); } catch { return null; } })() : null,
      })),
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

router.get('/entries', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { account_code, merchant_id, status, type, currency, reference, limit, offset } = req.query as any;
    const conds: string[] = [];
    const args: any[] = [];
    if (account_code) { conds.push('account_code = ?'); args.push(account_code); }
    if (merchant_id) { conds.push('merchant_id = ?'); args.push(merchant_id); }
    if (status) { conds.push('status = ?'); args.push(status); }
    if (type) { conds.push('type = ?'); args.push(type); }
    if (currency) { conds.push('currency = ?'); args.push(currency); }
    if (reference) { conds.push('(reference LIKE ? OR source_reference LIKE ?)'); args.push(`%${reference}%`, `%${reference}%`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const lim = Math.min(Number(limit || 500), 5000);
    const off = Number(offset || 0);
    const countR = await db.query(`SELECT COUNT(*) c FROM ledger_entries ${where}`, args);
    const rowsR = await db.query(
      `SELECT id, ledger_transaction_id, transaction_id, account_code, merchant_id, type, amount, currency, status,
              source_type, source_reference, source_network, reference, description, created_at
         FROM ledger_entries ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...args, lim, off]
    );
    const rows = (rowsR.rows || []).map((r: any) => ({
      ...r,
      amount: Number(r.amount),
      direction: r.type,
    }));
    const debits = rows.filter((r: any) => (r.direction || r.type) === 'debit').reduce((s: number, r: any) => s + r.amount, 0);
    const credits = rows.filter((r: any) => (r.direction || r.type) === 'credit').reduce((s: number, r: any) => s + r.amount, 0);
    return res.json({
      count: Number(countR.rows?.[0]?.c || 0),
      limit: lim,
      offset: off,
      filter_debits_sum: debits,
      filter_credits_sum: credits,
      filter_net: credits - debits,
      entries: rows,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

router.get('/balances/:account_code', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { account_code } = req.params;
    const { currency } = req.query as any;
    const ccy = currency ? String(currency).toUpperCase() : undefined;
    const all = await balancedLedgerEngine.getAccountBalance(
      account_code, ccy, ['PENDING', 'AUTHORIZED', 'CAPTURED', 'SETTLED', 'PAID_OUT'] as any
    );
    const settled = await balancedLedgerEngine.getAccountBalance(
      account_code, ccy, ['SETTLED', 'PAID_OUT'] as any
    );
    const authorized = await balancedLedgerEngine.getAccountBalance(
      account_code, ccy, ['AUTHORIZED', 'CAPTURED'] as any
    );
    const pending = await balancedLedgerEngine.getAccountBalance(
      account_code, ccy, ['PENDING'] as any
    );
    const acct = await db.query(
      `SELECT * FROM account_codes WHERE account_code = ? LIMIT 1`,
      [account_code]
    );
    return res.json({
      account_code,
      currency: ccy || 'ALL',
      balance_all_statuses: all,
      balance_settled: settled,
      balance_authorized: authorized,
      balance_pending: pending,
      available_for_payout: settled,
      account_metadata: acct.rows?.[0] || null,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

router.get('/account-codes', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const r = await db.query(`SELECT * FROM account_codes ORDER BY account_type, account_code`);
    return res.json({ count: (r.rows?.length || 0), codes: r.rows || [] });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

router.post('/merchant/:merchantId/settled-balance', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { merchantId } = req.params;
    const currency = String((req.query.currency || req.body?.currency || 'USD')).toUpperCase();
    const balance = await ledgerService.getSettledBalance(merchantId, currency);
    const accountCode = await balancedLedgerEngine.resolveMerchantWalletCode(merchantId, currency);
    return res.json({
      merchant_id: merchantId,
      currency,
      settled_balance: balance,
      account_code: accountCode,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

export { router as ledgerRouter };
export default router;
