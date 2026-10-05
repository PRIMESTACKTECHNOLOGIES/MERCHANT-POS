export enum PosProtocol {
  POS_101_1 = 'POS_101_1',
}

export const pos1011Config = Object.freeze({
  minAmountMinor: 5_000_000 * 100,
  maxAmountMinor: 500_000_000 * 100,
  requiresPin: true,
  requiresCvv: false,
  settlementMode: 'BRIDGE_USDT',
});
