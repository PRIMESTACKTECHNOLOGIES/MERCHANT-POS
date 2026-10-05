import crypto from 'crypto';

export type Iso8583MacAlgorithm =
  | 'HMAC-SHA256'
  | 'ISO9797-1-Alg3-3DES'
  | 'X9.19-3DES'
  | 'ANSI-X9.24-DUKPT-3DES'
  | 'ANSI-X9.24-DUKPT-AES';

export type AcquirerKeyMode = 'STATIC' | 'DUKPT';

export interface Iso8583MacSettings {
  keyMode?: AcquirerKeyMode;
  macAlgorithm?: Iso8583MacAlgorithm;
  macKey?: string;
  dukptIpek?: string;
  dukptKsn?: string;
  macField?: number;
  macLength?: number;
}

export interface MacEngine {
  calculateMac(messageBytes: Buffer, key: Buffer): Buffer;
  verifyMac(messageBytes: Buffer, key: Buffer, mac: Buffer): boolean;
}

export const normalizedMacSettings: Iso8583MacSettings = {
  keyMode: process.env.ACQUIRER_KEY_MODE === 'DUKPT' ? 'DUKPT' : 'STATIC',
  macAlgorithm: (process.env.ACQUIRER_MAC_ALGORITHM as Iso8583MacAlgorithm) || 'HMAC-SHA256',
  macKey: process.env.ACQUIRER_MAC_KEY?.trim() || undefined,
  dukptIpek: process.env.ACQUIRER_DUKPT_IPEK?.trim() || undefined,
  dukptKsn: process.env.ACQUIRER_DUKPT_KSN?.trim() || undefined,
  macField: process.env.ACQUIRER_MAC_FIELD ? Number(process.env.ACQUIRER_MAC_FIELD) : 64,
  macLength: process.env.ACQUIRER_MAC_LENGTH ? Number(process.env.ACQUIRER_MAC_LENGTH) : 8,
};

export const hmacSha256MacEngine: MacEngine = {
  calculateMac(messageBytes, key) {
    if (!key.length) throw new Error('ACQUIRER_MAC_KEY is required for MAC calculation');
    return crypto.createHmac('sha256', key).update(messageBytes).digest();
  },
  verifyMac(messageBytes, key, mac) {
    const expected = this.calculateMac(messageBytes, key);
    return expected.length === mac.length && crypto.timingSafeEqual(expected, mac);
  },
};

export interface KeyProvider {
  getMacKey(): Buffer;
  getPinKey?(): Buffer;
  getSessionKey?(): Buffer;
}

export class StaticKeyProvider implements KeyProvider {
  constructor(private readonly settings: Iso8583MacSettings = normalizedMacSettings) {}

  getMacKey(): Buffer {
    const value = this.settings.macKey?.trim() || process.env.ACQUIRER_MAC_KEY?.trim() || '';
    if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
      throw new Error('ACQUIRER_MAC_KEY must be an even-length hexadecimal key');
    }
    return Buffer.from(value, 'hex');
  }
}

export class DukptKeyProvider implements KeyProvider {
  constructor(private readonly settings: Iso8583MacSettings = normalizedMacSettings) {}

  getMacKey(): Buffer {
    const ipekValue = this.settings.dukptIpek?.trim() || process.env.ACQUIRER_DUKPT_IPEK?.trim() || '';
    const ksnValue = this.settings.dukptKsn?.trim() || process.env.ACQUIRER_DUKPT_KSN?.trim() || '';
    if (!ipekValue || !ksnValue) {
      throw new Error('DUKPT key configuration requires ACQUIRER_DUKPT_IPEK and ACQUIRER_DUKPT_KSN');
    }

    if (!/^[0-9a-f]+$/i.test(ipekValue) || !/^[0-9a-f]+$/i.test(ksnValue)) {
      throw new Error('DUKPT IPEK and KSN must be hexadecimal strings');
    }

    const ipek = Buffer.from(ipekValue, 'hex');
    const ksn = Buffer.from(ksnValue, 'hex');
    const targetLength = this.settings.macAlgorithm?.includes('AES') ? 16 : 24;

    const derived = Buffer.alloc(targetLength, 0x00);
    for (let i = 0; i < derived.length; i += 1) {
      derived[i] = (ipek[i % ipek.length] ^ ksn[i % ksn.length]) & 0xff;
    }

    return derived;
  }
}

export const envKeyProvider: KeyProvider = new StaticKeyProvider(normalizedMacSettings);

export class Iso8583MacEngine implements MacEngine {
  constructor(
    private readonly settings: Iso8583MacSettings = normalizedMacSettings,
    private readonly keyProvider: KeyProvider = settings.keyMode === 'DUKPT'
      ? new DukptKeyProvider(settings)
      : new StaticKeyProvider(settings),
  ) {}

  public getKeyProvider(): KeyProvider {
    return this.keyProvider;
  }

  calculateMac(messageBytes: Buffer, key: Buffer = this.keyProvider.getMacKey()): Buffer {
    const algorithm = this.settings.macAlgorithm || 'HMAC-SHA256';
    const output = (() => {
      switch (algorithm) {
        case 'HMAC-SHA256':
          return crypto.createHmac('sha256', key).update(messageBytes).digest();
        case 'ISO9797-1-Alg3-3DES':
          return this.calculateIso9797Alg3(messageBytes, key);
        case 'X9.19-3DES':
          return this.calculateX919(messageBytes, key);
        case 'ANSI-X9.24-DUKPT-3DES':
          return this.calculateIso9797Alg3(messageBytes, key);
        case 'ANSI-X9.24-DUKPT-AES':
          return this.calculateAesMac(messageBytes, key);
        default:
          throw new Error(`Unsupported ISO8583 MAC algorithm: ${algorithm}`);
      }
    })();

    const length = this.settings.macLength ?? 8;
    if (output.length === length) return output;
    if (output.length > length) return output.subarray(0, length);
    return Buffer.concat([output, Buffer.alloc(length - output.length, 0x00)]);
  }

  verifyMac(messageBytes: Buffer, key: Buffer, mac: Buffer): boolean {
    const expected = this.calculateMac(messageBytes, key);
    return expected.length === mac.length && crypto.timingSafeEqual(expected, mac);
  }

  private calculateIso9797Alg3(messageBytes: Buffer, key: Buffer): Buffer {
    const desKey = this.ensureTripleDesKeyLength(key);
    const iv = Buffer.alloc(8, 0x00);
    const padded = this.padIso9797(messageBytes, 8);
    const cipher = crypto.createCipheriv('des-ede3-cbc', desKey, iv);
    return Buffer.concat([cipher.update(padded), cipher.final()]).subarray(0, 8);
  }

  private calculateX919(messageBytes: Buffer, key: Buffer): Buffer {
    const desKey = this.ensureTripleDesKeyLength(key);
    const iv = Buffer.alloc(8, 0x00);
    const cipher = crypto.createCipheriv('des-ede3-cbc', desKey, iv);
    return Buffer.concat([cipher.update(this.padIso9797(messageBytes, 8)), cipher.final()]).subarray(0, 8);
  }

  private calculateAesMac(messageBytes: Buffer, key: Buffer): Buffer {
    const aesKey = key.length === 16 ? key : key.subarray(0, 16);
    const iv = Buffer.alloc(16, 0x00);
    const cipher = crypto.createCipheriv('aes-128-cbc', aesKey, iv);
    return Buffer.concat([cipher.update(this.padPkcs7(messageBytes, 16)), cipher.final()]).subarray(0, 16);
  }

  private ensureTripleDesKeyLength(key: Buffer): Buffer {
    if (key.length === 8) return Buffer.concat([key, key, key]);
    if (key.length === 16) return Buffer.concat([key, key.subarray(0, 8)]);
    if (key.length === 24) return key;
    throw new Error(`Unsupported key length for 3DES MAC: ${key.length}`);
  }

  private padIso9797(data: Buffer, blockSize: number): Buffer {
    const remainder = data.length % blockSize;
    if (remainder === 0) return data;
    const padLen = blockSize - remainder;
    return Buffer.concat([data, Buffer.alloc(padLen, padLen)]);
  }

  private padPkcs7(data: Buffer, blockSize: number): Buffer {
    const remainder = data.length % blockSize;
    if (remainder === 0) return data;
    const padLen = blockSize - remainder;
    return Buffer.concat([data, Buffer.alloc(padLen, padLen)]);
  }
}

export function createIso8583MacEngine(settings: Iso8583MacSettings = normalizedMacSettings): Iso8583MacEngine {
  return new Iso8583MacEngine(settings, settings.keyMode === 'DUKPT'
    ? new DukptKeyProvider(settings)
    : new StaticKeyProvider(settings));
}
