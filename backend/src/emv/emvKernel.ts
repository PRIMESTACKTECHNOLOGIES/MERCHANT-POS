import { posService } from '../pos/posService';
import type { PosCard, PosProcessor, PosTerminal } from '../pos/models';
import { pos1011EmvProfile } from './pos1011EmvProfile';

export type EmvChipContext = {
  terminal: PosTerminal;
  card: PosCard & { enteredPin?: string };
  amountMinor: number;
  currency: string;
  processor: PosProcessor;
};

export class EmvKernel {
  async processChipTransaction(ctx: EmvChipContext) {
    const emvResult = await this.runEmvFlow(ctx);
    if (pos1011EmvProfile.onlineOnly && !emvResult.onlineRequired) {
      throw new Error('POS 101.1 requires online authorization');
    }
    return posService.processPos1011Sale({
      amountMinor: ctx.amountMinor,
      currency: ctx.currency,
      card: ctx.card,
      terminal: ctx.terminal,
      processor: ctx.processor,
      pin: emvResult.pin,
    });
  }

  private async runEmvFlow(ctx: EmvChipContext) {
    if (!ctx.card.enteredPin) throw new Error('EMV PIN verification required');
    return { onlineRequired: true, pin: ctx.card.enteredPin };
  }
}

export const emvKernel = new EmvKernel();
