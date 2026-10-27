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

export interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  created_at: string;
  updated_at: string;
}

export interface WalletBalance {
  balance: number;
  currency: string;
}

export interface WalletTransaction {
  id: string;
  wallet_id: string;
  type: "credit" | "debit";
  amount: number;
  source: string;
  reference?: string;
  description?: string;
  created_at: string;
}
