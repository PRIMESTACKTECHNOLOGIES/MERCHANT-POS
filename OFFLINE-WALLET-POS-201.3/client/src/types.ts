export interface Terminal {
  id: string;
  name: string;
  merchantId: string;
  terminalId: string;
  offlineEnabled: boolean;
  lastBatchAt?: string;
  
  // Optional extended fields
  status?: 'ONLINE' | 'OFFLINE';
  ipAddress?: string;
  appVersion?: string;
}
