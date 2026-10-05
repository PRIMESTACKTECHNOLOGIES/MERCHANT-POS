import { emvKernel, type EmvChipContext } from '../emv/emvKernel';
import { recordPosLedgerEvent } from './ledger';
import { pos1011ScalingLock } from './pos1011ScalingLock';

export class Pos1011Pipeline {
  async execute(ctx: EmvChipContext) {
    pos1011ScalingLock.ensureExecutionAllowed();
    const result = await emvKernel.processChipTransaction(ctx);
    await recordPosLedgerEvent('POS_1011_PIPELINE_COMPLETE', ctx.amountMinor, ctx.currency.toUpperCase(), {
      terminalId: ctx.terminal.id,
      protocol: 'POS_101_1',
      pipelineStatus: result.status,
    }, `pos1011-pipeline-${ctx.terminal.id}-${Date.now()}`);
    pos1011ScalingLock.lockFirstRound(result);
    return result;
  }
}

export const pos1011Pipeline = new Pos1011Pipeline();
