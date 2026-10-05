export type Pos1011Batch = {
  id: string;
  status: 'OPEN' | 'CLOSED' | 'SETTLED';
  currency: string;
  asset: string;
  totalAmountMinor: number;
  txIds: string[];
  createdAt: string;
  settledAt?: string;
};
