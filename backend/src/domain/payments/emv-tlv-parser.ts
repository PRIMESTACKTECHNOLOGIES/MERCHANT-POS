export interface EmvTlvMap {
  [tag: string]: Buffer;
}

export const EMV_TAGS: Record<string, string> = {
  '5F20': 'Cardholder Name',
  '57': 'Track 2 Equivalent Data',
  '5A': 'PAN',
  '5F24': 'Expiry Date',
  '9F26': 'Application Cryptogram',
  '9F10': 'Issuer Application Data',
  '9F36': 'ATC',
  '9F37': 'Unpredictable Number',
  '9F02': 'Amount, Authorized',
  '9F03': 'Amount, Other',
  '9F1A': 'Terminal Country Code',
  '9F33': 'Terminal Capabilities',
  '9F34': 'CVM Results',
  '9F35': 'Terminal Type',
  '9A': 'Transaction Date',
  '9C': 'Transaction Type',
  '9F41': 'Transaction Sequence Counter',
  '9F07': 'Application Usage Control',
  '9F6E': 'Visa / Mastercard Enhanced Data',
  '82': 'AIP',
  '84': 'DF Name',
  '9F12': 'Application Preferred Name',
  '9F1B': 'Terminal Floor Limit',
  '9F1C': 'Terminal Action Code – Default',
  '9F1D': 'Terminal Action Code – Denial',
  '9F1F': 'Terminal Action Code – Online',
  '5F2A': 'Transaction Currency Code',
  '95': 'Terminal Verification Results',
  '9F53': 'Consecutive Offline Transaction Limit'
};

export function parseTlv(buffer: Buffer): EmvTlvMap {
  const tlv: EmvTlvMap = {};
  let offset = 0;

  while (offset < buffer.length) {
    let tag = buffer[offset].toString(16).padStart(2, '0').toUpperCase();
    offset += 1;

    // Multi-byte tag
    if ((parseInt(tag, 16) & 0x1f) === 0x1f) {
      if (offset >= buffer.length) break;
      const next = buffer[offset].toString(16).padStart(2, '0').toUpperCase();
      tag += next;
      offset += 1;
      while ((parseInt(next, 16) & 0x80) === 0x80 && offset < buffer.length) {
        const extra = buffer[offset].toString(16).padStart(2, '0').toUpperCase();
        tag += extra;
        offset += 1;
      }
    }

    if (offset >= buffer.length) break;

    let length = buffer[offset];
    offset += 1;

    if (length & 0x80) {
      const lengthBytes = length & 0x7f;
      length = 0;
      for (let i = 0; i < lengthBytes && offset < buffer.length; i++) {
        length = (length << 8) | buffer[offset];
        offset += 1;
      }
    }

    if (offset + length > buffer.length) {
      break;
    }

    const value = buffer.slice(offset, offset + length);
    offset += length;
    tlv[tag] = value;
  }

  return tlv;
}

/**
 * Recursive TLV parse.
 *
 * `parseTlv` only reads the top level, so data nested inside constructed
 * templates (FCI `6F`/`A5`, GPO `77`, records `70`, `BF0C`…) is invisible —
 * e.g. AIP (`82`), AFL (`94`), PAN (`5A`), Track 2 (`57`), AC (`9F26`).
 * Contactless reads return almost everything nested, so those templates must
 * be traversed. Values are flattened into a single map (later wins).
 */
export function parseTlvDeep(buffer: Buffer): EmvTlvMap {
  const tlv: EmvTlvMap = {};
  flattenTlv(buffer, tlv);
  return tlv;
}

function flattenTlv(buffer: Buffer, out: EmvTlvMap): void {
  let offset = 0;

  while (offset < buffer.length) {
    const tagStart = offset;
    let tag = buffer[offset].toString(16).padStart(2, '0').toUpperCase();
    offset += 1;

    if ((parseInt(tag, 16) & 0x1f) === 0x1f) {
      if (offset >= buffer.length) break;
      let next = buffer[offset];
      tag += next.toString(16).padStart(2, '0').toUpperCase();
      offset += 1;
      while ((next & 0x80) === 0x80 && offset < buffer.length) {
        next = buffer[offset];
        tag += next.toString(16).padStart(2, '0').toUpperCase();
        offset += 1;
      }
    }

    if (offset >= buffer.length) break;

    let length = buffer[offset];
    offset += 1;

    if (length & 0x80) {
      const lengthBytes = length & 0x7f;
      length = 0;
      for (let i = 0; i < lengthBytes && offset < buffer.length; i++) {
        length = (length << 8) | buffer[offset];
        offset += 1;
      }
    }

    if (offset + length > buffer.length) break;

    const value = buffer.slice(offset, offset + length);
    offset += length;

    out[tag] = value;

    if ((buffer[tagStart] & 0x20) === 0x20 && value.length > 0) {
      flattenTlv(value, out);
    }
  }
}

const EMV_TAG_PROPERTY: Record<string, string> = {
  '9F02': 'amountAuthorized',
  '9F03': 'amountOther',
  '5A': 'pan',
  '5F24': 'expiry',
  '57': 'track2',
  '9F26': 'cryptogram',
  '9F36': 'atc',
  '9F37': 'unpredictableNumber',
  '9F10': 'issuerApplicationData',
  '9F33': 'terminalCapabilities',
  '9F34': 'cvmResults',
  '9F35': 'terminalType',
  '9F1A': 'terminalCountryCode',
  '9A': 'transactionDate',
  '9C': 'transactionType',
  '9F41': 'transactionSequenceCounter',
  '9F07': 'applicationUsageControl',
  '9F6E': 'enhancedData',
  '82': 'aip',
  '84': 'aid',
  '5F2A': 'transactionCurrencyCode',
  '9F1E': 'interfaceDeviceSerialNumber',
  '9F12': 'applicationPreferredName',
  '9F1B': 'terminalFloorLimit',
  '9F1C': 'terminalActionCodeDefault',
  '9F1D': 'terminalActionCodeDenial',
  '9F1F': 'terminalActionCodeOnline',
  '95': 'terminalVerificationResults',
};

export function extractEmvData(tlv: EmvTlvMap, rawTlvHex?: string) {
  const out: Record<string, string> = {};

  if (rawTlvHex) {
    out.field55 = rawTlvHex.toUpperCase();
  }

  for (const tag of Object.keys(tlv)) {
    const value = tlv[tag];
    const hex = value.toString('hex').toUpperCase();
    const shortKey = EMV_TAG_PROPERTY[tag];

    out[tag] = hex;

    if (tag === '5F20') {
      out.cardholderName = value.toString('utf8').trim();
    }
    if (tag === '5A') {
      out.pan = hex.replace(/F+$/, '');
    }
    if (tag === '5F24') {
      out.expiry = hex.slice(0, 4);
    }
    if (tag === '57') {
      const track2 = hex;
      const [pan, rest] = track2.split('D');
      out.pan = pan;
      out.expiry = rest?.slice(0, 4) || out.expiry;
      out.track2 = track2;
    }

    if (shortKey && !['5A', '5F24', '57', '5F20'].includes(tag)) {
      out[shortKey] = hex;
    }
  }

  return out;
}

export function buildEmvChargePayload(emv: any): Record<string, unknown> | undefined {
  if (!emv || typeof emv !== 'object') {
    return undefined;
  }

  const payload: Record<string, unknown> = {};
  const valueOf = (keys: string[]) => {
    for (const key of keys) {
      const value = emv[key];
      if (value !== undefined && value !== null && value !== "") {
        return String(value).toUpperCase();
      }
    }
    return undefined;
  };

  const field55 = valueOf(['field55', 'field55Hex', 'tlvRaw', 'TLV', '55']);
  if (field55) payload.field55 = field55;

  const entries: Array<[string, string[]]> = [
    ['track2', ['track2', '57']],
    ['aid', ['aid', '84', '9F06']],
    ['cryptogram', ['cryptogram', 'arqc', '9F26']],
    ['atc', ['atc', '9F36']],
    ['cvmResult', ['cvmResult', '9F34']],
    ['unpredictableNumber', ['unpredictableNumber', '9F37']],
    ['issuerApplicationData', ['issuerApplicationData', '9F10']],
    ['terminalCapabilities', ['terminalCapabilities', '9F33']],
    ['terminalType', ['terminalType', '9F35']],
    ['terminalCountryCode', ['terminalCountryCode', '9F1A']],
    ['transactionDate', ['transactionDate', '9A']],
    ['transactionType', ['transactionType', '9C']],
    ['transactionSequenceCounter', ['transactionSequenceCounter', '9F41']],
    ['applicationUsageControl', ['applicationUsageControl', '9F07']],
    ['enhancedData', ['enhancedData', '9F6E']],
    ['aip', ['aip', '82']],
    ['amountAuthorized', ['amountAuthorized', '9F02']],
    ['amountOther', ['amountOther', '9F03']],
    ['transactionCurrencyCode', ['transactionCurrencyCode', '5F2A']],
    ['terminalVerificationResults', ['terminalVerificationResults', '95']],
    ['pan', ['pan', '5A']],
    ['expiry', ['expiry', '5F24']],
  ];

  for (const [key, candidates] of entries) {
    const value = valueOf(candidates);
    if (value) {
      payload[key] = value;
    }
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
}
