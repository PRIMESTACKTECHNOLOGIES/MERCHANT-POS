import { IsoFieldDefinition, isoProfile } from './iso8583.profile';
import { defaultUnframed, IsoFraming } from './iso8583.framing';
import { envKeyProvider, KeyProvider, MacEngine } from './iso8583.security';
import { decodeIsoField, encodeIsoField } from './iso8583.fields';
import { buildIsoBitmap, parseIsoBitmap } from './iso8583.bitmap';

export interface IsoCodecOptions {
  lengthPrefix?: 'none' | 'uint16be' | 'ascii4';
  header?: Buffer;
  mac?: IsoMac;
  framing?: IsoFraming;
  macEngine?: MacEngine;
  keyProvider?: KeyProvider;
}

export interface IsoMac {
  field: number;
  calculate(messageWithoutMac: Buffer): Buffer;
  verify?: (messageWithoutMac: Buffer, receivedMac: Buffer) => boolean;
}

export interface IsoMessage {
  mti: string;
  fields: Record<number, string | Buffer>;
}

export class Iso8583Codec {
  constructor(
    private readonly profile: Record<number, IsoFieldDefinition> = isoProfile,
    private readonly options: IsoCodecOptions = {},
  ) {}

  pack(message: IsoMessage): Buffer {
    if (!/^\d{4}$/.test(message.mti)) throw new Error('ISO8583 MTI must be four digits');
    const fieldNumbers = Object.keys(message.fields).map(Number);
    const { bitmap, fieldIds } = buildIsoBitmap(fieldNumbers);
    const body = [Buffer.from(message.mti, 'ascii'), bitmap];
    for (const field of fieldIds) {
      const definition = this.profile[field];
      if (!definition) throw new Error(`No ISO8583 profile definition for field ${field}`);
      if (this.options.mac?.field === field) continue;
      body.push(encodeIsoField(field, message.fields[field], definition));
    }
    const withoutMac = Buffer.concat(body);
    const mac = this.options.mac
      ? encodeIsoField(this.options.mac.field, this.calculateMac(withoutMac), this.profile[this.options.mac.field])
      : Buffer.alloc(0);
    const payload = Buffer.concat([withoutMac, mac]);
    return this.options.framing ? this.options.framing.addHeader(payload) : this.frame(payload);
  }

  unpack(raw: Buffer): IsoMessage {
    const unframed = this.options.framing ? this.options.framing.removeHeader(raw) : this.unframe(raw);
    const headerLength = this.options.header?.length || 0;
    if (headerLength && !unframed.subarray(0, headerLength).equals(this.options.header!)) {
      throw new Error('Unexpected ISO8583 header/TPDU');
    }
    raw = unframed.subarray(headerLength);
    if (raw.length < 12) throw new Error('ISO8583 message is shorter than MTI and bitmap');
    const mti = raw.subarray(0, 4).toString('ascii');
    if (!/^\d{4}$/.test(mti)) throw new Error('Invalid ISO8583 MTI');

    const parsedBitmap = parseIsoBitmap(raw.subarray(4));
    const fields: Record<number, string | Buffer> = {};
    let offset = 4 + parsedBitmap.consumed;

    for (const field of parsedBitmap.fieldIds) {
      const definition = this.profile[field];
      if (!definition) throw new Error(`No ISO8583 profile definition for field ${field}`);
      const decoded = decodeIsoField(field, raw, offset, definition);
      fields[field] = decoded.value;
      offset = decoded.nextOffset;
    }
    if (offset !== raw.length) throw new Error('Unexpected trailing bytes in ISO8583 message');
    if (this.options.mac) {
      const macField = this.options.mac.field;
      const receivedMac = fields[macField];
      if (!receivedMac) throw new Error(`ISO8583 MAC field ${macField} missing`);
      delete fields[macField];
      if (this.options.mac.verify || this.options.macEngine) {
        const unsigned = new Iso8583Codec(this.profile, {
          lengthPrefix: 'none',
          mac: undefined,
        }).pack({ mti, fields });
        const received = Buffer.isBuffer(receivedMac) ? receivedMac : Buffer.from(String(receivedMac), 'hex');
        const calculated = this.options.mac.verify
          ? this.options.mac.verify(unsigned, received)
          : this.options.macEngine!.verifyMac(unsigned, this.getMacKey(), received);
        if (!calculated) throw new Error('ISO8583 MAC verification failed');
      }
    }

    return { mti, fields };
  }

  private calculateMac(message: Buffer): Buffer {
        if (this.options.macEngine) {
          return this.options.macEngine.calculateMac(message, this.getMacKey());
        }
        if (this.options.mac) return this.options.mac.calculate(message);
        throw new Error('ISO8583 MAC engine is not configured');
      }

  private getMacKey(): Buffer {
        return (this.options.keyProvider || envKeyProvider).getMacKey();
  }
  private frame(payload: Buffer): Buffer {
    const withHeader = Buffer.concat([this.options.header || Buffer.alloc(0), payload]);
    if (this.options.lengthPrefix === 'ascii4') {
      return Buffer.concat([Buffer.from(String(withHeader.length).padStart(4, '0'), 'ascii'), withHeader]);
    }
    if (this.options.lengthPrefix === 'uint16be') {
      if (withHeader.length > 0xffff) throw new Error('ISO8583 frame exceeds uint16 length');
      const length = Buffer.alloc(2);
      length.writeUInt16BE(withHeader.length, 0);
      return Buffer.concat([length, withHeader]);
    }
    return withHeader;
  }

  private unframe(raw: Buffer): Buffer {
    if (this.options.lengthPrefix === 'ascii4') {
      if (raw.length < 4) throw new Error('Incomplete ISO8583 ASCII length prefix');
      const length = Number(raw.subarray(0, 4).toString('ascii'));
      if (!Number.isInteger(length) || raw.length < length + 4) throw new Error('Invalid ISO8583 ASCII length prefix');
      return raw.subarray(4, length + 4);
    }
    if (this.options.lengthPrefix === 'uint16be') {
      if (raw.length < 2) throw new Error('Incomplete ISO8583 binary length prefix');
      const length = raw.readUInt16BE(0);
      if (raw.length < length + 2) throw new Error('Invalid ISO8583 binary length prefix');
      return raw.subarray(2, length + 2);
    }
    return raw;
  }

}
