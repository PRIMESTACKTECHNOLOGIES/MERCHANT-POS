/**
 * Issuer EMV Validator
 * Validates ARQC using HSM and returns ARC + issuer scripts.
 */

import { parseEmvField55 } from './emvField55Parser';
import { HsmClient } from './hsmClient';
import { cdol1FromField55 } from '../../issuer/emvCdol';

export class IssuerEmvValidator {
  constructor(private readonly hsm: HsmClient) {}

  async validate(
    field55Hex:      string,
    pan:             string,
    expiryYYMM:      string,  // "YYMM" e.g. "3005"
    amountMinor:     number,
    currencyNumeric: string,  // e.g. "840" = USD
  ): Promise<{ arc: string; scripts: Buffer[] }> {

    const emv = parseEmvField55(field55Hex);

    if (!emv.arqc) throw new Error('EMV_MISSING_TAGS: 9F26 ARQC required');
    if (!emv.iad)  throw new Error('EMV_MISSING_TAGS: 9F10 IAD required');
    if (!emv.tvr)  throw new Error('EMV_MISSING_TAGS: 95 TVR required');

    // The HSM has to MAC the same bytes the card signed, so rebuild CDOL1 from
    // the presented Field 55 rather than letting each provider guess it.
    const { cdol1Hex, missing } = cdol1FromField55(emv);
    if (missing.length) {
      throw new Error(`EMV_MISSING_TAGS: ${missing.join(',')} required for CDOL1`);
    }

    const atcBuf = emv.atc || Buffer.from([0x00, 0x01]);
    const atc    = (atcBuf[0] << 8) | atcBuf[1];
    const un     = emv.unpredictableNumber || Buffer.from('00000000', 'hex');

    const res = await this.hsm.validateArqc({
      pan,
      expiry:              expiryYYMM,
      amountMinor,
      currencyCode:        currencyNumeric,
      atc,
      unpredictableNumber: un,
      arqc:                emv.arqc,
      iad:                 emv.iad,
      cdol1Hex,
    });

    if (!res.valid) {
      throw new Error(`EMV_ARQC_INVALID_ARC_${res.arc}`);
    }

    return {
      arc:     res.arc,
      scripts: res.scripts || [],
    };
  }
}
