import { PosError, PosErrorCode, PosDeviceCode, PosStatusFlag } from './posError';
export enum EmvState {
  INIT='INIT',READ_APPLICATION='READ_APPLICATION',DATA_AUTHENTICATION='DATA_AUTHENTICATION',
  PROCESS_RESTRICTIONS='PROCESS_RESTRICTIONS',CARDHOLDER_VERIFICATION='CARDHOLDER_VERIFICATION',
  TERMINAL_RISK_MANAGEMENT='TERMINAL_RISK_MANAGEMENT',ACTION_ANALYSIS='ACTION_ANALYSIS',
  ONLINE_PROCESSING='ONLINE_PROCESSING',ISSUER_RESPONSE='ISSUER_RESPONSE',COMPLETION='COMPLETION',
}
export enum EmvDecision { APPROVE='APPROVE', DECLINE='DECLINE', ONLINE='ONLINE' }
export interface EmvContext {
  state:EmvState; pan?:string; expiry?:string; track2?:string; field55Hex?:string;
  arqcHex?:string; arpcHex?:string; atcHex?:string; amountMinor:number; currency:string;
  merchantId:string; terminalId:string; aidSelected?:string; aipHex?:string;
  cvmResult?:string; tvr:number; tsi:number; authCode?:string; responseCode?:string;
  decision?:EmvDecision; scripts?:string[]; flags:number; error?:PosError;
}
type H=(ctx:EmvContext)=>Promise<EmvContext>;
export class TerminalStateMachine {
  private h=new Map<EmvState,H>();
  constructor(){
    const s=EmvState;
    this.h.set(s.INIT,this.hInit.bind(this));
    this.h.set(s.READ_APPLICATION,this.hReadApp.bind(this));
    this.h.set(s.DATA_AUTHENTICATION,this.hDataAuth.bind(this));
    this.h.set(s.PROCESS_RESTRICTIONS,this.hRestrictions.bind(this));
    this.h.set(s.CARDHOLDER_VERIFICATION,this.hCVM.bind(this));
    this.h.set(s.TERMINAL_RISK_MANAGEMENT,this.hTRM.bind(this));
    this.h.set(s.ACTION_ANALYSIS,this.hAction.bind(this));
    this.h.set(s.ONLINE_PROCESSING,this.hOnline.bind(this));
    this.h.set(s.ISSUER_RESPONSE,this.hIssuer.bind(this));
    this.h.set(s.COMPLETION,this.hCompletion.bind(this));
  }
  async run(ctx:EmvContext):Promise<EmvContext>{
    const order=[EmvState.INIT,EmvState.READ_APPLICATION,EmvState.DATA_AUTHENTICATION,
      EmvState.PROCESS_RESTRICTIONS,EmvState.CARDHOLDER_VERIFICATION,
      EmvState.TERMINAL_RISK_MANAGEMENT,EmvState.ACTION_ANALYSIS,
      EmvState.ONLINE_PROCESSING,EmvState.ISSUER_RESPONSE,EmvState.COMPLETION];
    let cur=ctx;
    for(const s of order){
      cur={...cur,state:s};
      const h=this.h.get(s);
      if(h)cur=await h(cur);
      if(cur.decision===EmvDecision.DECLINE)break;
    }
    return cur;
  }
  private async hInit(ctx:EmvContext):Promise<EmvContext>{
    if(!ctx.merchantId||!ctx.terminalId)return{...ctx,decision:EmvDecision.DECLINE,error:new PosError(PosErrorCode.MERCHANT_NOT_CONFIG,'Merchant/Terminal not configured')};
    return{...ctx,tvr:0,tsi:0,flags:0};
  }
  private async hReadApp(ctx:EmvContext):Promise<EmvContext>{
    if(!ctx.pan||!ctx.field55Hex)return{...ctx,decision:EmvDecision.DECLINE,error:new PosError(PosErrorCode.ICC_READ_ERROR,'PAN or Field55 missing',PosDeviceCode.ICC_READER,PosStatusFlag.ICC_CONTACT_FAIL)};
    return ctx;
  }
  private async hDataAuth(ctx:EmvContext):Promise<EmvContext>{
    return{...ctx,tvr:ctx.tvr|(1<<28)};
  }
  private async hRestrictions(ctx:EmvContext):Promise<EmvContext>{
    if(ctx.expiry){
      const yy=parseInt(ctx.expiry.slice(0,2),10),mm=parseInt(ctx.expiry.slice(2,4),10);
      if(new Date()>new Date(2000+yy,mm,0))return{...ctx,tvr:ctx.tvr|(1<<20),decision:EmvDecision.DECLINE,error:new PosError(PosErrorCode.APDU_FAILURE,'Card expired')};
    }
    return ctx;
  }
  private async hCVM(ctx:EmvContext):Promise<EmvContext>{
    return{...ctx,tsi:ctx.tsi|(1<<14),cvmResult:ctx.cvmResult||'NO_CVM'};
  }
  private async hTRM(ctx:EmvContext):Promise<EmvContext>{
    const{terminalRiskEngine}=await import('./terminalRiskManagement');
    const risk=await terminalRiskEngine.assess(ctx);
    const tvr=ctx.tvr|risk.tvrBits;
    if(risk.forceDecline)return{...ctx,tvr,decision:EmvDecision.DECLINE,error:new PosError(PosErrorCode.EMV_KERNEL_EXCEPTION,risk.reason,PosDeviceCode.ICC_READER,PosStatusFlag.TERMINAL_RISK_TRIGGERED)};
    return{...ctx,tvr};
  }
  private async hAction(ctx:EmvContext):Promise<EmvContext>{
    if(ctx.arqcHex)return{...ctx,decision:EmvDecision.ONLINE};
    return{...ctx,decision:EmvDecision.DECLINE,error:new PosError(PosErrorCode.ARQC_INVALID,'ARQC missing')};
  }
  private async hOnline(ctx:EmvContext):Promise<EmvContext>{
    return{...ctx,tsi:ctx.tsi|(1<<13)};
  }
  private async hIssuer(ctx:EmvContext):Promise<EmvContext>{
    if(ctx.responseCode==='00'){
      if(ctx.scripts&&ctx.scripts.length>0){const{issuerScriptProcessor}=await import('./issuerScriptProcessor');await issuerScriptProcessor.process(ctx.scripts);}
      if(ctx.arpcHex&&ctx.arqcHex){const{verifyArpc}=await import('./arpcVerifier');const valid=await verifyArpc(ctx.arqcHex,ctx.arpcHex,ctx.responseCode||'00');if(!valid)return{...ctx,decision:EmvDecision.DECLINE,error:new PosError(PosErrorCode.ARPC_VERIFY_FAILED,'ARPC verification failed')};}
      return{...ctx,decision:EmvDecision.APPROVE};
    }
    return{...ctx,decision:EmvDecision.DECLINE,flags:ctx.flags|PosStatusFlag.HOST_DECLINE};
  }
  private async hCompletion(ctx:EmvContext):Promise<EmvContext>{
    return{...ctx,tsi:ctx.tsi|(1<<15)};
  }
}
export const terminalStateMachine=new TerminalStateMachine();