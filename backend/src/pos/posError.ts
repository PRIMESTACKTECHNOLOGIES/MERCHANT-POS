export enum PosErrorCode {
  ICC_READ_ERROR=100,ATR_TIMEOUT=101,APDU_FAILURE=102,CVM_FAILED=103,
  NFC_COLLISION=104,TRACK2_CORRUPTED=105,PIN_PAD_TAMPER=106,
  PRINTER_NO_PAPER=107,TERMINAL_TAMPERED=108,KEY_INJECTION_MISSING=109,
  EMV_KERNEL_EXCEPTION=110,HOST_TIMEOUT=200,HOST_DECLINED=201,
  HOST_UNREACHABLE=202,HOST_INVALID_RESPONSE=203,ARQC_INVALID=300,
  ARPC_VERIFY_FAILED=301,PIN_BLOCK_ERROR=302,KEY_DERIVATION_FAILED=303,
  SAF_FULL=400,SAF_REPLAY_FAILED=401,SAF_INTEGRITY_ERROR=402,
  TERMINAL_NOT_INIT=500,MERCHANT_NOT_CONFIG=501,BATCH_OPEN_FAILED=502,REVERSAL_FAILED=503,
}
export enum PosDeviceCode {
  ICC_READER=0x01,NFC_READER=0x02,MAGSTRIPE=0x03,PRINTER=0x04,
  PIN_PAD=0x05,SECURE_ELEMENT=0x06,BATTERY=0x07,TAMPER_MODULE=0x08,
  DISPLAY=0x09,KEYPAD=0x0A,
}
export enum PosStatusFlag {
  CARD_REMOVED_EARLY=1<<0,ICC_CONTACT_FAIL=1<<1,ATR_INVALID=1<<2,
  APDU_RETRY_EXCEEDED=1<<3,CVM_NOT_SUPPORTED=1<<4,
  TERMINAL_RISK_TRIGGERED=1<<5,OFFLINE_DECLINE=1<<6,HOST_DECLINE=1<<7,
}
export class PosError extends Error {
  constructor(
    public readonly code:PosErrorCode,
    public readonly detail:string,
    public readonly device:PosDeviceCode=PosDeviceCode.ICC_READER,
    public readonly flags:number=0,
    public readonly data:Record<string,unknown>={},
  ){super(`[POS ${code}] ${detail}`);this.name='PosError';}
  toJSON(){return{posStatus:this.code,posStatusName:PosErrorCode[this.code],posData:this.detail,posDevice:PosDeviceCode[this.device],posFlags:`0b${this.flags.toString(2).padStart(8,'0')}`,data:this.data};}
}