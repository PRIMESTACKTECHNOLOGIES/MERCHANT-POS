import crypto from 'crypto';
import { db } from '../config/db';
import { v4 as uuidv4 } from 'uuid';
import { PosError, PosErrorCode } from './posError';
export interface SafTransaction {
  id:string; merchantId:string; terminalId:string; pan_last4:string;
  amountMinor:number; currency:string; authCode:string; field55Hex?:string;
  stan:string; capturedAt:string; retryCount:number;
  status:'PENDING'|'SYNCED'|'FAILED'; hmac:string;
}
const SAF_TABLE=`CREATE TABLE IF NOT EXISTS saf_transactions(id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL,terminal_id TEXT NOT NULL,pan_last4 TEXT NOT NULL,amount_minor INTEGER NOT NULL,currency TEXT NOT NULL DEFAULT 'USD',auth_code TEXT NOT NULL,field55_hex TEXT,stan TEXT NOT NULL,captured_at TEXT NOT NULL,retry_count INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'PENDING',hmac TEXT NOT NULL)`;
function sign(txn:Omit<SafTransaction,'hmac'>):string{
  const key=process.env.ISSUER_SECRET_KEY||'PRIMESTACK-SAF-KEY';
  return crypto.createHmac('sha256',key).update(`${txn.id}|${txn.merchantId}|${txn.amountMinor}|${txn.currency}|${txn.stan}|${txn.capturedAt}`).digest('hex');
}
export class SafEngine {
  async store(txn:Omit<SafTransaction,'id'|'retryCount'|'status'|'hmac'|'capturedAt'>):Promise<SafTransaction>{
    await db.query(SAF_TABLE);
    const cnt=(await db.query("SELECT COUNT(*) c FROM saf_transactions WHERE status='PENDING'")).rows[0] as any;
    if(Number(cnt?.c||0)>=500)throw new PosError(PosErrorCode.SAF_FULL,'SAF storage full');
    const id=uuidv4(),capturedAt=new Date().toISOString();
    const partial={...txn,id,capturedAt,retryCount:0,status:'PENDING' as const};
    const hmac=sign(partial);
    const full:SafTransaction={...partial,hmac};
    await db.query(`INSERT INTO saf_transactions(id,merchant_id,terminal_id,pan_last4,amount_minor,currency,auth_code,field55_hex,stan,captured_at,retry_count,status,hmac)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,[full.id,full.merchantId,full.terminalId,full.pan_last4,full.amountMinor,full.currency,full.authCode,full.field55Hex||null,full.stan,full.capturedAt,0,'PENDING',full.hmac]);
    return full;
  }
  async getPending(limit=50):Promise<SafTransaction[]>{
    await db.query(SAF_TABLE);
    const rows=(await db.query("SELECT * FROM saf_transactions WHERE status='PENDING' AND retry_count<5 ORDER BY captured_at ASC LIMIT?",[limit])).rows as any[];
    return rows.map(r=>({id:r.id,merchantId:r.merchant_id,terminalId:r.terminal_id,pan_last4:r.pan_last4,amountMinor:Number(r.amount_minor),currency:r.currency,authCode:r.auth_code,field55Hex:r.field55_hex,stan:r.stan,capturedAt:r.captured_at,retryCount:Number(r.retry_count),status:r.status,hmac:r.hmac}));
  }
  async markSynced(id:string):Promise<void>{await db.query("UPDATE saf_transactions SET status='SYNCED' WHERE id=?",[id]);}
  async markFailed(id:string):Promise<void>{await db.query("UPDATE saf_transactions SET status='FAILED',retry_count=retry_count+1 WHERE id=?",[id]);}
  async verifyIntegrity(txn:SafTransaction):Promise<boolean>{return sign({...txn})===txn.hmac;}
  async replay(onReplay:(txn:SafTransaction)=>Promise<boolean>):Promise<{synced:number;failed:number}>{
    const pending=await this.getPending();let synced=0,failed=0;
    for(const txn of pending){
      if(!await this.verifyIntegrity(txn)){await this.markFailed(txn.id);failed++;continue;}
      try{const ok=await onReplay(txn);if(ok){await this.markSynced(txn.id);synced++;}else{await this.markFailed(txn.id);failed++;}}
      catch{await this.markFailed(txn.id);failed++;}
    }
    return{synced,failed};
  }
}
export const safEngine=new SafEngine();