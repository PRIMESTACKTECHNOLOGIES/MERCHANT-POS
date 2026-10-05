export type BridgeSettlementRequest = {
  amountMinor: number;
  sourceCurrency: string;
  protocol: string;
  authorizationReference: string;
};

export type BridgeSettlementResult = {
  asset: 'USDT';
  amountMinor: number;
  status: 'NOT_SETTLED' | 'SETTLED';
  reason: string;
};

/**
 * No wallet distribution is performed by the default adapter. A production
 * bridge must be implemented against a licensed provider with webhook
 * verification, idempotency, compliance checks, and ledger reconciliation.
 */
export const bridgeService = {
  async settleToUsdt(_request: BridgeSettlementRequest): Promise<BridgeSettlementResult> {
    return {
      asset: 'USDT',
      amountMinor: 0,
      status: 'NOT_SETTLED',
      reason: 'SETTLEMENT_BRIDGE_NOT_CONFIGURED',
    };
  },
};
