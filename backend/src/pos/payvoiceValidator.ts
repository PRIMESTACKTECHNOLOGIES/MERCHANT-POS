import crypto from 'crypto';

export type Pos1011Payvoice = {
  id: string;
  authorizedAmountMinor: number;
  protocol: string;
  signature: string;
};

export class PayvoiceValidator {
  validate(payvoice: Pos1011Payvoice, requestAmountMinor: number) {
    if (!payvoice?.id || payvoice.protocol !== 'POS_101_1') {
      throw new Error('Payvoice not valid for POS 101.1');
    }
    if (!Number.isSafeInteger(payvoice.authorizedAmountMinor) ||
        requestAmountMinor > payvoice.authorizedAmountMinor) {
      throw new Error('Requested amount exceeds payvoice authorization');
    }
    if (!this.verifySignature(payvoice)) throw new Error('Invalid payvoice signature');
  }

  private verifySignature(payvoice: Pos1011Payvoice) {
    const secret = process.env.POS_PAYVOICE_SECRET?.trim();
    if (!secret) return false;
    const canonical = `${payvoice.id}.${payvoice.authorizedAmountMinor}.${payvoice.protocol}`;
    const expected = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
    const supplied = payvoice.signature.trim().toLowerCase();
    return supplied.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  }
}

export const payvoiceValidator = new PayvoiceValidator();
