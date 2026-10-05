import { IsoFieldDefinition } from './iso8583.profile';

export interface DecodedIsoField {
  value: string | Buffer;
  nextOffset: number;
}

export function encodeIsoField(
  field: number,
  value: string | Buffer,
  definition: IsoFieldDefinition,
): Buffer {
  const encoding = definition.encoding || (definition.type === 'B' ? 'binary' : 'ascii');
  const text = Buffer.isBuffer(value) ? undefined : String(value);
  const data = Buffer.isBuffer(value)
    ? Buffer.from(value)
    : encoding === 'bcd'
      ? packBcd(field, text!)
      : Buffer.from(text!, encoding === 'binary' ? 'hex' : 'ascii');

  if (encoding === 'ascii' && !/^[\x20-\x7e]*$/.test(text!)) {
    throw new Error(`Field ${field} contains non-ASCII characters`);
  }
  if (encoding === 'bcd' && !/^\d+$/.test(text!)) {
    throw new Error(`Field ${field} must contain only digits`);
  }

  const logicalLength = encoding === 'bcd' ? text!.length : data.length;
  if (definition.variable === 'FIXED') {
    if (logicalLength !== definition.length) {
      throw new Error(`Field ${field} must be exactly ${definition.length} ${encoding === 'bcd' ? 'digits' : 'bytes'}`);
    }
    return data;
  }

  const prefixLength = definition.variable === 'LLVAR' ? 2 : 3;
  if (logicalLength > definition.length) {
    throw new Error(`Field ${field} exceeds ${definition.length} ${encoding === 'bcd' ? 'digits' : 'bytes'}`);
  }
  return Buffer.concat([
    Buffer.from(String(logicalLength).padStart(prefixLength, '0'), 'ascii'),
    data,
  ]);
}

export function decodeIsoField(
  field: number,
  buffer: Buffer,
  offset: number,
  definition: IsoFieldDefinition,
): DecodedIsoField {
  const encoding = definition.encoding || (definition.type === 'B' ? 'binary' : 'ascii');
  let logicalLength = definition.length;
  let nextOffset = offset;

  if (definition.variable && definition.variable !== 'FIXED') {
    const prefixLength = definition.variable === 'LLVAR' ? 2 : 3;
    if (nextOffset + prefixLength > buffer.length) {
      throw new Error(`Field ${field} has an incomplete length prefix`);
    }
    const prefix = buffer.subarray(nextOffset, nextOffset + prefixLength).toString('ascii');
    if (!new RegExp(`^\\d{${prefixLength}}$`).test(prefix)) {
      throw new Error(`Field ${field} has an invalid length prefix`);
    }
    logicalLength = Number(prefix);
    if (logicalLength > definition.length) {
      throw new Error(`Field ${field} exceeds ${definition.length} ${encoding === 'bcd' ? 'digits' : 'bytes'}`);
    }
    nextOffset += prefixLength;
  }

  const byteLength = encoding === 'bcd' ? Math.ceil(logicalLength / 2) : logicalLength;
  if (nextOffset + byteLength > buffer.length) {
    throw new Error(`Field ${field} is incomplete`);
  }
  const data = buffer.subarray(nextOffset, nextOffset + byteLength);

  if (encoding === 'bcd') {
    return { value: unpackBcd(field, data, logicalLength), nextOffset: nextOffset + byteLength };
  }
  if (encoding === 'binary') {
    return { value: Buffer.from(data), nextOffset: nextOffset + byteLength };
  }
  const value = data.toString('ascii');
  if (!/^[\x20-\x7e]*$/.test(value)) throw new Error(`Field ${field} contains non-ASCII bytes`);
  return { value, nextOffset: nextOffset + byteLength };
}

function packBcd(field: number, value: string): Buffer {
  if (!/^\d+$/.test(value)) throw new Error(`Field ${field} must contain only digits`);
  const padded = value.length % 2 === 0 ? value : `0${value}`;
  const result = Buffer.alloc(padded.length / 2);
  for (let index = 0; index < padded.length; index += 2) {
    result[index / 2] = parseInt(padded.slice(index, index + 2), 16);
  }
  return result;
}

function unpackBcd(field: number, data: Buffer, digitLength: number): string {
  let value = '';
  for (const byte of data) {
    const high = byte >> 4;
    const low = byte & 0x0f;
    if (high > 9 || low > 9) throw new Error(`Field ${field} contains invalid BCD`);
    value += `${high}${low}`;
  }
  return value.slice(-digitLength);
}
