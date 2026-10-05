import { isoProfile } from '../domain/payments/acquirer/iso8583.profile';
import type { IsoMessage } from '../domain/payments/acquirer/iso8583.codec';

function transmissionDateTime(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

export function buildPos10110200(opts: {
  panToken: string;
  amountMinor: number;
  currencyCode: string;
  stan: string;
  terminalId: string;
  merchantId: string;
  entryMode: string;
}): IsoMessage {
  if (!opts.panToken || opts.panToken.length > 512) throw new Error('Tokenized PAN reference is required');
  if (!Number.isSafeInteger(opts.amountMinor) || opts.amountMinor <= 0) throw new Error('Amount must be a positive integer in minor units');
  if (!/^\d{3}$/.test(opts.currencyCode)) throw new Error('ISO currency code must be numeric');
  if (!/^\d{6}$/.test(opts.stan)) throw new Error('STAN must be six digits');
  if (!/^\d{3}$/.test(opts.entryMode)) throw new Error('POS entry mode must be three digits');

  // Field 2 carries the provider token/reference. Raw PAN must be resolved only
  // inside a PCI-compliant processor adapter, never in this application.
  return {
    mti: '0200',
    fields: {
      2: opts.panToken,
      3: '000000',
      4: String(opts.amountMinor).padStart(12, '0'),
      7: transmissionDateTime(),
      11: opts.stan,
      22: opts.entryMode,
      25: '00',
      32: opts.merchantId,
      41: opts.terminalId,
      49: opts.currencyCode,
    },
  };
}

void isoProfile;
