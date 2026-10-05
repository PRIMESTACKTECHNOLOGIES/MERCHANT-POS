import { pos1011Pipeline } from './pos1011Pipeline';
import { payvoiceValidator, type Pos1011Payvoice } from './payvoiceValidator';

export async function executePos1011(ctx: {
  terminal: Parameters<typeof pos1011Pipeline.execute>[0]['terminal'];
  card: Parameters<typeof pos1011Pipeline.execute>[0]['card'];
  amountMinor: number;
  currency: string;
  processor: Parameters<typeof pos1011Pipeline.execute>[0]['processor'];
  payvoice: Pos1011Payvoice;
}) {
  payvoiceValidator.validate(ctx.payvoice, ctx.amountMinor);
  return pos1011Pipeline.execute(ctx);
}
