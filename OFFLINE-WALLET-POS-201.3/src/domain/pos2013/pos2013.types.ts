// src/domain/pos2013/pos2013.types.ts 
 export interface Pos2013OfflineTxn { 
   localTxnId: string; 
   stan: string; 
   amountMinor: number; 
   currency: string; 
   panMasked: string; 
   txnType: "SALE" | "REFUND"; 
   txnTimestamp: string; 
   authMode: "OFFLINE_APPROVED" | "OFFLINE_DECLINED"; 
   entryMode: "CHIP" | "MAGSTRIPE" | "CONTACTLESS"; 
   rrn?: string | null; 
   authCode?: string | null; 
   emvData?: Record<string, string>; 
 } 
 
 export interface Pos2013OfflineBatchRequest { 
  protocolVersion: "201.3"; 
  merchantId: string; 
  terminalId: string; 
  batchId: string; 
  batchCreatedAt: string; 
  nonce: string; 
  timestamp: string; 
  signature: string; 
  transactions: Pos2013OfflineTxn[]; 
} 
 
 export interface Pos2013OfflineBatchResponse { 
  protocolVersion: "201.3"; 
  merchantId: string; 
  terminalId: string; 
  batchId: string; 
  results: Array<{ 
    localTxnId: string; 
    serverTxnId: string; 
    status: "ACCEPTED" | "DUPLICATE" | "REJECTED"; 
    message?: string; 
  }>; 
}