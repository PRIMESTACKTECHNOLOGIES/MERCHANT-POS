import type { PosCard } from './models';

export class PaxSimulator {
  runScreen(amountMinor: number, currency: string, card: PosCard) {
    return {
      screen: 'PAX TERMINAL POS',
      mode: 'Online Sale 101.1',
      protocol: 'POS_101_1',
      pinRequired: true,
      cvvRequired: false,
      cardLast4: card.panToken.slice(-4),
      amountMinor,
      currency: currency.toUpperCase(),
      bridge: 'USDT',
      status: 'READY',
    };
  }
}

export const paxSimulator = new PaxSimulator();
