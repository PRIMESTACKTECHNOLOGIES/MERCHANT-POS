import { pos1011Config, PosProtocol } from '../core/PosProtocol';
import type { PosCard, PosProcessor, PosTerminal } from './models';

export type Pos1011Intake = {
  amountMinor: number;
  card: PosCard;
  terminal: PosTerminal;
  processor: PosProcessor;
  pin: string;
};

export class Pos1011Validator {
  validateIntake(req: Pos1011Intake) {
    if (!Number.isSafeInteger(req.amountMinor) ||
        req.amountMinor < pos1011Config.minAmountMinor ||
        req.amountMinor > pos1011Config.maxAmountMinor) {
      throw new Error('Amount out of POS 101.1 range');
    }
    if (!req.card?.panToken || req.card.panToken.length > 512) {
      throw new Error('A tokenized card reference is required');
    }
    if (req.card.scheme !== 'VISA') throw new Error('POS 101.1 requires a supported card scheme');
    if (!req.terminal?.online || req.terminal.protocol !== PosProtocol.POS_101_1) {
      throw new Error('Terminal not ready for POS 101.1');
    }
    if (req.terminal.provider !== 'PAX') throw new Error('Unsupported POS terminal provider');
    if (!req.processor?.supportsProtocol?.includes(PosProtocol.POS_101_1)) {
      throw new Error('Processor does not support POS 101.1');
    }
    if (pos1011Config.requiresPin && !/^\d{4}$/.test(req.pin || '')) {
      throw new Error('Invalid PIN for POS 101.1');
    }
  }
}

export const pos1011Validator = new Pos1011Validator();
