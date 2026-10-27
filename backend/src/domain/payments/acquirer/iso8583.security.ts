import crypto from 'crypto';
import {
  BLOCK_SIZE,
  KEY_SIZE_BYTES,
  ISO_8583_SECURITY,
  HASH_SPECS,
  type MacAlgorithm,
} from '../../../config/crypto.spec';

export type Iso8583MacAlgorithm =
  | MacAlgorithm
  | 'HMAC-SHA256'
  | 'HMAC-SHA512'
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
  keyMode: process.env.ACQUIRER_KEY_MODE?.toUpperCase() === 'DUKPT' ? 'DUKPT' : 'STATIC',
  macAlgorithm: (process.env.ACQUIRER_MAC_ALGORITHM as Iso8583MacAlgorithm) || ISO_8583_SECURITY.DEFAULT_MAC_ALGORITHM,
  macKey: process.env.ACQUIRER_MAC_KEY?.trim() || undefined,
  dukptIpek: process.env.ACQUIRER_DUKPT_IPEK?.trim() || undefined,
  dukptKsn: process.env.ACQUIRER_DUKPT_KSN?.trim() || undefined,
  macField: process.env.ACQUIRER_MAC_FIELD ? Number(process.env.ACQUIRER_MAC_FIELD) : ISO_8583_SECURITY.DEFAULT_MAC_FIELD,
  macLength: process.env.ACQUIRER_MAC_LENGTH ? Number(process.env.ACQUIRER_MAC_LENGTH) : ISO_8583_SECURITY.DEFAULT_MAC_LENGTH_BYTES,
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
    const alg = String(this.settings.macAlgorithm || '').toLowerCase();
    const targetLength = alg.includes('aes') ? BLOCK_SIZE.AES_256 : KEY_SIZE_BYTES.TRIPLE_DES_3KEY;

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

  private normalizeAlgorithm(alg: Iso8583MacAlgorithm | undefined): string {
    const a = String(alg || ISO_8583_SECURITY.DEFAULT_MAC_ALGORITHM).toLowerCase().replace(/[\s_-]/g, '-');
    if (a.includes('hmac') && a.includes('sha512')) return 'hmac-sha512';
    if (a.includes('hmac') && a.includes('sha256')) return 'hmac-sha256';
    if (a.includes('hmac') && a.includes('sha1'))   return 'hmac-sha1';
    if (a.includes('hmac') && a.includes('md5'))    return 'hmac-md5';
    if (a.includes('retail') || a.includes('9797') || (a.includes('x9') && a.includes('19') && !a.includes('24'))) {
      return a.includes('aes') ? 'cbc-mac-aes' : 'retail-mac-3des';
    }
    if (a.includes('dukpt') && a.includes('aes'))  return 'cbc-mac-aes';
    if (a.includes('dukpt') || a.includes('cbc') && a.includes('3des')) return 'cbc-mac-3des';
    if (a.includes('aes'))                          return 'cbc-mac-aes';
    return 'retail-mac-3des';
  }

  calculateMac(messageBytes: Buffer, key: Buffer = this.keyProvider.getMacKey()): Buffer {
    const normalized = this.normalizeAlgorithm(this.settings.macAlgorithm);
    const output = (() => {
      switch (normalized) {
        case 'hmac-sha512':
          return crypto.createHmac('sha512', key).update(messageBytes).digest();
        case 'hmac-sha256':
          return crypto.createHmac('sha256', key).update(messageBytes).digest();
        case 'hmac-sha1':
          return crypto.createHmac('sha1', key).update(messageBytes).digest();
        case 'hmac-md5':
          return crypto.createHmac('md5', key).update(messageBytes).digest();
        case 'cbc-mac-aes':
          return this.calculateAesMac(messageBytes, key);
        case 'retail-mac-3des':
          return this.calculateIso9797Alg3(messageBytes, key);
        case 'cbc-mac-3des':
          return this.calculateX919(messageBytes, key);
        default:
          throw new Error(`Unsupported ISO8583 MAC algorithm (normalized): ${normalized}`);
      }
    })();

    const length = this.settings.macLength ?? ISO_8583_SECURITY.DEFAULT_MAC_LENGTH_BYTES;
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
    const iv = Buffer.alloc(BLOCK_SIZE.TRIPLE_DES, 0x00);
    const padded = this.padIso9797(messageBytes, BLOCK_SIZE.TRIPLE_DES);
    const cipher = crypto.createCipheriv('des-ede3-cbc', desKey, iv);
    return Buffer.concat([cipher.update(padded), cipher.final()]).subarray(0, BLOCK_SIZE.TRIPLE_DES);
  }

  private calculateX919(messageBytes: Buffer, key: Buffer): Buffer {
    const desKey = this.ensureTripleDesKeyLength(key);
    const iv = Buffer.alloc(BLOCK_SIZE.TRIPLE_DES, 0x00);
    const cipher = crypto.createCipheriv('des-ede3-cbc', desKey, iv);
    return Buffer.concat([cipher.update(this.padIso9797(messageBytes, BLOCK_SIZE.TRIPLE_DES)), cipher.final()]).subarray(0, BLOCK_SIZE.TRIPLE_DES);
  }

  private calculateAesMac(messageBytes: Buffer, key: Buffer): Buffer {
    const aesKey = key.length === BLOCK_SIZE.AES_128 ? key : key.subarray(0, BLOCK_SIZE.AES_128);
    const iv = Buffer.alloc(BLOCK_SIZE.AES_128, 0x00);
    const cipher = crypto.createCipheriv('aes-128-cbc', aesKey, iv);
    return Buffer.concat([cipher.update(this.padPkcs7(messageBytes, BLOCK_SIZE.AES_128)), cipher.final()]).subarray(0, BLOCK_SIZE.AES_128);
  }

  private ensureTripleDesKeyLength(key: Buffer): Buffer {
    if (key.length === BLOCK_SIZE.DES)                                   return Buffer.concat([key, key, key]);
    if (key.length === KEY_SIZE_BYTES.TRIPLE_DES_2KEY)                   return Buffer.concat([key, key.subarray(0, BLOCK_SIZE.DES)]);
    if (key.length === KEY_SIZE_BYTES.TRIPLE_DES_3KEY)                   return key;
    throw new Error(`Unsupported key length for 3DES MAC: ${key.length} (expected ${BLOCK_SIZE.DES}/${KEY_SIZE_BYTES.TRIPLE_DES_2KEY}/${KEY_SIZE_BYTES.TRIPLE_DES_3KEY} bytes)`);
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
