import type { IsoMessage } from '../domain/payments/acquirer/iso8583.codec';
import type { IssuerAuthorization } from './issuerClient';
import type { IssuerEngine } from './issuerEngine';

export class IssuerIsoHost {
  constructor(private readonly engine: IssuerEngine) {}

  handle0200(request: IsoMessage): IsoMessage {
    if (request.mti !== '0200') throw new Error('Issuer host expects MTI 0200');
    const panReference = String(request.fields[2] || '');
    const amountMinor = Number.parseInt(String(request.fields[4] || ''), 10);
    const currencyCode = String(request.fields[49] || '');
    const stan = String(request.fields[11] || '');
    if (!panReference || !Number.isSafeInteger(amountMinor) || !currencyCode || !stan) {
      throw new Error('Required ISO8583 authorization fields are missing');
    }
    const result = this.engine.authorize(panReference, amountMinor, currencyCode) as IssuerAuthorization & { responseCode?: string };
    const response: IsoMessage = {
      mti: '0210',
      fields: {
        2: panReference,
        4: String(request.fields[4]),
        11: stan,
        39: result.responseCode || (result.approved ? '00' : '05'),
      },
    };
    if (result.authCode) response.fields[38] = result.authCode;
    return response;
  }
}
