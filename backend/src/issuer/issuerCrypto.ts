import crypto from "crypto";

export type IssuerCryptoInput = {
  pan: string;
  panSequence?: string;
  atc: string;
  cdol1Hex: string;
};

export type IssuerCryptoResult = {
  arqc: string;
  arpc: string;
};

function hex(value: string, name: string): Buffer {
  const normalized = String(value || "").replace(/\s+/g, "").toUpperCase();
  if (!normalized || normalized.length % 2 !== 0 || !/^[0-9A-F]+$/.test(normalized)) {
    throw new Error(`${name}_MUST_BE_HEX`);
  }
  return Buffer.from(normalized, "hex");
}

function normalizePan(pan: string): string {
  const value = String(pan || "").replace(/\D/g, "");
  if (value.length < 13 || value.length > 19) throw new Error("PAN_LENGTH_INVALID");
  return value;
}

function expandTwoKey3Des(key: Buffer): Buffer {
  if (key.length === 24) return key;
  if (key.length !== 16) throw new Error("EMV_IMK_MUST_BE_16_OR_24_BYTES");
  return Buffer.concat([key, key.subarray(0, 8)]);
}

function encryptBlock(key: Buffer, block: Buffer): Buffer {
  const cipher = crypto.createCipheriv("des-ede3-ecb", expandTwoKey3Des(key), null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

function encryptSingleDes(key: Buffer, block: Buffer): Buffer {
  if (key.length !== 8 || block.length !== 8) throw new Error("DES_BLOCK_SIZE_INVALID");
  // Use 3DES K1/K1/K1 because OpenSSL 3 disables the legacy single-DES cipher.
  const cipher = crypto.createCipheriv("des-ede3-ecb", Buffer.concat([key, key, key]), null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

function xor(left: Buffer, right: Buffer): Buffer {
  if (left.length !== right.length) throw new Error("CRYPTO_XOR_LENGTH_MISMATCH");
  return Buffer.from(left.map((value, index) => value ^ right[index]));
}

function deriveUdk(imk: Buffer, pan: string, panSequence: string): Buffer {
  const panPsn = Buffer.from(`${pan}${panSequence}`.padEnd(16, "F").slice(0, 16), "hex");
  const left = encryptBlock(imk, panPsn);
  const right = encryptBlock(imk, xor(panPsn, Buffer.alloc(8, 0xFF)));
  return Buffer.concat([left, right]);
}

function deriveSessionKey(udk: Buffer, atc: Buffer): Buffer {
  if (atc.length !== 2) throw new Error("ATC_MUST_BE_2_BYTES");
  const diversification = Buffer.concat([
    atc,
    Buffer.alloc(6),
    atc,
    Buffer.alloc(6),
  ]);
  return Buffer.concat([
    encryptBlock(udk, diversification.subarray(0, 8)),
    encryptBlock(udk, diversification.subarray(8, 16)),
  ]);
}

function retailMac(key: Buffer, data: Buffer): Buffer {
  const paddedLength = Math.ceil((data.length + 1) / 8) * 8;
  const padded = Buffer.alloc(paddedLength);
  data.copy(padded);
  padded[data.length] = 0x80;

  let state = Buffer.alloc(8) as Buffer<ArrayBufferLike>;
  const singleDesKey = expandTwoKey3Des(key).subarray(0, 8);
  for (let offset = 0; offset < padded.length; offset += 8) {
    state = encryptSingleDes(singleDesKey, xor(state, padded.subarray(offset, offset + 8)));
  }
  const decrypt = crypto.createDecipheriv("des-ede3-ecb", expandTwoKey3Des(key), null);
  decrypt.setAutoPadding(false);
  const decrypted = Buffer.concat([decrypt.update(state), decrypt.final()]);
  return Buffer.from(encryptSingleDes(singleDesKey, decrypted));
}

/**
 * Software implementation for certification/sandbox testing only.
 * Production deployments must replace this provider with an HSM adapter.
 */
export class SoftwareEmvIssuerCrypto {
  constructor(private readonly issuerMasterKey: Buffer) {}

  static fromEnvironment(): SoftwareEmvIssuerCrypto {
    const configured = process.env.EMV_ISSUER_MASTER_KEY_HEX;
    if (!configured) throw new Error("EMV_ISSUER_MASTER_KEY_HEX_NOT_CONFIGURED");
    return new SoftwareEmvIssuerCrypto(hex(configured, "EMV_ISSUER_MASTER_KEY_HEX"));
  }

  generate(input: IssuerCryptoInput): IssuerCryptoResult {
    const pan = normalizePan(input.pan);
    const atc = hex(input.atc, "ATC");
    const cdol1 = hex(input.cdol1Hex, "CDOL1");
    const udk = deriveUdk(this.issuerMasterKey, pan, String(input.panSequence || "00").padStart(2, "0"));
    const sessionKey = deriveSessionKey(udk, atc);
    const arqc = retailMac(sessionKey, cdol1).subarray(0, 8).toString("hex").toUpperCase();
    const arpc = this.generateArpcWithSession(sessionKey, arqc, "00");
    return { arqc, arpc };
  }

  generateArpc(input: IssuerCryptoInput & { arqc: string; responseCode?: string }): string {
    const pan = normalizePan(input.pan);
    const atc = hex(input.atc, "ATC");
    const udk = deriveUdk(this.issuerMasterKey, pan, String(input.panSequence || "00").padStart(2, "0"));
    const sessionKey = deriveSessionKey(udk, atc);
    return this.generateArpcWithSession(sessionKey, input.arqc, input.responseCode || "00");
  }

  private generateArpcWithSession(sessionKey: Buffer, arqc: string, responseCode: string): string {
    const arpcInput = Buffer.from(arqc, "hex");
    const response = Buffer.from(responseCode.padStart(2, "0").slice(0, 2), "hex");
    arpcInput[0] ^= response[0];
    arpcInput[1] ^= response[1];
    return encryptBlock(sessionKey, arpcInput).toString("hex").toUpperCase();
  }

  validate(input: IssuerCryptoInput & { arqc: string }): IssuerCryptoResult {
    const generated = this.generate(input);
    const supplied = hex(input.arqc, "ARQC");
    if (supplied.length !== 8 || !crypto.timingSafeEqual(supplied, Buffer.from(generated.arqc, "hex"))) {
      throw new Error("EMV_ARQC_INVALID");
    }
    return generated;
  }
}
