import { db } from '../config/db';
import { v4 as uuidv4 } from 'uuid';
import { PosError, PosErrorCode } from './posError';
export interface ReversalRequest { originalTxnId:string; merchantId:string; reason:'TIMEOUT'|'CARD_REMOVED'|'HOST_DECLINED'|'OPERATOR'|'SYSTEM'; amountMinor?:number; }
export interface ReversalResult { reversalId:string; originalId:string; amountReversed:number; currency:string; status:'REVERSED'|'PARTIAL'; reversedAt:string; }
export class ReversalEngine {
  async reverse(req:ReversalRequest):Promise<ReversalResult>{
    const orig=(await db.query('SELECT * FROM pos2013_transactions WHERE id=? AND merchant_id=? LIMIT 1',[req.originalTxnId,req.merchantId])).rows[0] as any;
    if(!orig)throw new PosError(PosErrorCode.REVERSAL_FAILED,`Original ${req.originalTxnId} not found`);
    if(orig.status==='REVERSED')throw new PosError(PosErrorCode.REVERSAL_FAILED,'Already reversed');
    const originalAmount=Number(orig.amount_minor)/100;
    const reversalAmount=req.amountMinor?req.amountMinor/100:originalAmount;
    const isPartial=reversalAmount<originalAmount;
    const now=new Date().toISOString(),reversalId=uuidv4();
    const existing = (await db.query(
      'SELECT id, status, amount_minor, currency FROM pos2013_transactions WHERE txn_type = ? AND local_txn_id = ? LIMIT 1',
      ['REVERSAL', req.originalTxnId],
    )).rows?.[0] as any;
    if (existing) {
      return {
        reversalId: String(existing.id),
        originalId: req.originalTxnId,
        amountReversed: Number(existing.amount_minor) / 100,
        currency: String(existing.currency || orig.currency || 'USD'),
        status: existing.status === 'PARTIAL_REVERSED' ? 'PARTIAL' : 'REVERSED',
        reversedAt: now,
      };
    }
    const { vaultEngine } = await import('../domain/vault/vault.service');
    await vaultEngine.debitVault({
      amount: reversalAmount,
      currency: orig.currency || 'USD',
      reference: reversalId,
      merchantId: req.merchantId,
      type: 'REVERSAL',
      meta: { originalTxnId: req.originalTxnId, reason: req.reason },
    });
    const merchantWallet = (await db.query(
      'SELECT id, balance FROM merchant_wallets WHERE merchant_id = ? AND currency = ? LIMIT 1',
      [req.merchantId, orig.currency || 'USD'],
    )).rows?.[0] as any;
    if (!merchantWallet || Number(merchantWallet.balance) < reversalAmount) {
      throw new PosError(PosErrorCode.REVERSAL_FAILED, 'Merchant wallet has insufficient settled funds');
    }
    await db.query('BEGIN IMMEDIATE');
    try {
      await db.query(
        'UPDATE merchant_wallets SET balance = balance - ?, updated_at = ? WHERE id = ?',
        [reversalAmount, now, merchantWallet.id],
      );
      await db.query(
        `INSERT INTO merchant_wallet_transactions
          (id, wallet_id, type, amount, currency, source, reference, description, created_at)
         VALUES (?, ?, 'debit', ?, ?, 'reversal', ?, ?, ?)`,
        [uuidv4(), merchantWallet.id, reversalAmount, orig.currency || 'USD', reversalId, `Reversal: ${req.reason}`, now],
      );
      await db.query("UPDATE pos2013_transactions SET status=? WHERE id=?",[isPartial?'PARTIAL_REVERSED':'REVERSED', req.originalTxnId]);
      await db.query(`INSERT INTO pos2013_transactions(id,merchant_id,terminal_id,batch_id,local_txn_id,stan,amount_minor,currency,pan_masked,txn_type,auth_mode,entry_mode,auth_code,status,txn_timestamp,decline_reason)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[reversalId,req.merchantId,orig.terminal_id||'',`REV-${reversalId.slice(0,8)}`,req.originalTxnId,orig.stan||'',Math.round(reversalAmount*100),orig.currency||'USD',orig.pan_masked,'REVERSAL',req.reason,orig.entry_mode||'MANUAL',orig.auth_code||'','REVERSED',now,`Reversal: ${req.reason}`]);
      await db.query('COMMIT');
    } catch (error) {
      try { await db.query('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
    console.log(`[Reversal] ${req.reason} — ${orig.currency} ${reversalAmount} from ${req.originalTxnId}`);
    return{reversalId,originalId:req.originalTxnId,amountReversed:reversalAmount,currency:orig.currency||'USD',status:isPartial?'PARTIAL':'REVERSED',reversedAt:now};
  }
}
export const reversalEngine=new ReversalEngine();