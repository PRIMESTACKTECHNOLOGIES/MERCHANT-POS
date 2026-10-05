/**
 * EMV Field 55 (DE55) TLV Parser
 * Extracts all mandatory tags from the hex TLV block.
 */

export interface ParsedEmvField55 {
  arqc?:               Buffer;  // 9F26
  cid?:                Buffer;  // 9F27
  iad?:                Buffer;  // 9F10
  unpredictableNumber?: Buffer; // 9F37
  atc?:                Buffer;  // 9F36
  tvr?:                Buffer;  // 95
  tsi?:                Buffer;  // 9F35 (or 9B)
  txnDate?:            Buffer;  // 9A
  txnType?:            Buffer;  // 9C
  amount?:             Buffer;  // 9F02
  currency?:           Buffer;  // 5F2A
  aip?:                Buffer;  // 82
  termCountry?:        Buffer;  // 9F1A
  termCaps?:           Buffer;  // 9F33
  cvr?:                Buffer;  // 9F34
  termType?:           Buffer;  // 9F35
  ifdSerial?:          Buffer;  // 9F1E
  aid?:                Buffer;  // 84
  appVersion?:         Buffer;  // 9F09
  seqCounter?:         Buffer;  // 9F41
  [tag: string]:       Buffer | undefined;
}

const TAG_MAP: Record<string, keyof ParsedEmvField55> = {
  '9F26': 'arqc',
  '9F27': 'cid',
  '9F10': 'iad',
  '9F37': 'unpredictableNumber',
  '9F36': 'atc',
  '95':   'tvr',
  '9B':   'tsi',
  '9A':   'txnDate',
  '9C':   'txnType',
  '9F02': 'amount',
  '5F2A': 'currency',
  '82':   'aip',
  '9F1A': 'termCountry',
  '9F33': 'termCaps',
  '9F34': 'cvr',
  '9F35': 'termType',
  '9F1E': 'ifdSerial',
  '84':   'aid',
  '9F09': 'appVersion',
  '9F41': 'seqCounter',
};

export function parseEmvField55(tlvHex: string): ParsedEmvField55 {
  const result: ParsedEmvField55 = {};
  const src = tlvHex.replace(/\s/g, '').toUpperCase();
  let i = 0;

  while (i < src.length) {
    if (i + 2 > src.length) break;

    // Determine tag length (1 or 2 bytes)
    let tag: string;
    const firstByte = parseInt(src.slice(i, i + 2), 16);
    if ((firstByte & 0x1F) === 0x1F) {
      // Two-byte tag
      if (i + 4 > src.length) break;
      tag = src.slice(i, i + 4);
      i += 4;
    } else {
      tag = src.slice(i, i + 2);
      i += 2;
    }

    // Length
    if (i + 2 > src.length) break;
    const lenByte = parseInt(src.slice(i, i + 2), 16);
    i += 2;

    let length: number;
    if (lenByte === 0x81) {
      if (i + 2 > src.length) break;
      length = parseInt(src.slice(i, i + 2), 16);
      i += 2;
    } else if (lenByte === 0x82) {
      if (i + 4 > src.length) break;
      length = parseInt(src.slice(i, i + 4), 16);
      i += 4;
    } else {
      length = lenByte;
    }

    const valueHex = src.slice(i, i + length * 2);
    i += length * 2;

    if (valueHex.length !== length * 2) break;

    const fieldName = TAG_MAP[tag];
    if (fieldName) {
      (result as any)[fieldName] = Buffer.from(valueHex, 'hex');
    } else {
      (result as any)[tag] = Buffer.from(valueHex, 'hex');
    }
  }

  return result;
}
