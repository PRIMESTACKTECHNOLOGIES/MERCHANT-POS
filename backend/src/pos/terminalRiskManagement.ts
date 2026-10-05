import { db } from '../config/db';
import type { EmvContext } from './terminalStateMachine';
export interface RiskAssessment { tvrBits:number; forceDecline:boolean; reason:string; goOnline:boolean; }
export class TerminalRiskEngine {
  async assess(ctx: EmvContext): Promise<RiskAssessment> {
    let tvrBits=0, forceDecline=false, goOnline=false;
    const reasons: string[]=[];
    const floorLimit=await this.getFloorLimit(ctx.terminalId);
    const amount=ctx.amountMinor/100;
    if(amount>floorLimit){tvrBits|=(1<<23);goOnline=true;reasons.push(`Amount ${amount} > floor ${floorLimit}`);}
    if(Math.random()<0.10){tvrBits|=(1<<22);goOnline=true;reasons.push('Random selection');}
    if(ctx.pan){
      const vel=await this.checkVelocity(ctx.pan);
      if(vel>10){tvrBits|=(1<<21);forceDecline=true;reasons.push(`Velocity exceeded: ${vel}/hr`);}
      const blocked=await this.checkExceptionFile(ctx.pan);
      if(blocked){forceDecline=true;reasons.push('Card on exception file');}
    }
    return{tvrBits,forceDecline,reason:reasons.join('; ')||'OK',goOnline:goOnline&&!forceDecline};
  }
  private async getFloorLimit(terminalId:string):Promise<number>{
    try{const r=await db.query('SELECT floor_limit FROM terminals WHERE terminal_id=? LIMIT 1',[terminalId]);return Number((r.rows[0] as any)?.floor_limit||150000);}catch{return 150000;}
  }
  private async checkVelocity(pan:string):Promise<number>{
    try{const last4=pan.slice(-4),hourAgo=new Date(Date.now()-3600000).toISOString();const r=await db.query("SELECT COUNT(*) c FROM pos2013_transactions WHERE pan_masked LIKE ? AND txn_timestamp>? AND status='APPROVED'",[`%${last4}`,hourAgo]);return Number((r.rows[0] as any)?.c||0);}catch{return 0;}
  }
  private async checkExceptionFile(pan:string):Promise<boolean>{
    try{const r=await db.query("SELECT COUNT(*) c FROM card_authorizations WHERE card_number=? AND status='BLOCKED'",[pan]);return Number((r.rows[0] as any)?.c||0)>0;}catch{return false;}
  }
}
export const terminalRiskEngine = new TerminalRiskEngine();