import crypto from "crypto";

export type EmvCurrencyCode = "840" | "978" | "826" | "356" | string;

export interface EmvField55Input {
  arqc?: string;
  cid?: string;
  iad?: string;
  unpredictable?: string;
  unpredictableNumber?: string;
  atc?: string;
  tvr?: string;
  txnDate?: string;
  txnType?: string;
  amountMinor?: number;
  amountOtherMinor?: number;
  currency?: EmvCurrencyCode;
  aip?: string;
  terminalCountry?: string;
  terminalCapabilities?: string;
  cvr?: string;
  terminalType?: string;
  ifdSerial?: string;
  aid?: string;
  appVersion?: string;
  sequenceCounter?: string;
  pan?: string;
  terminalId?: string;
  merchantId?: string;
  secret?: string;
}

export function normalizeHex(value: string): string {
  return (value || "").replace(/0x/i, "").replace(/\s+/g, "").toUpperCase();
}

export function encodeHexTlv(tagHex: string, valueHex: string): string {
  const cleanTag = normalizeHex(tagHex);
  const cleanValue = normalizeHex(valueHex);
  if (!cleanTag || !cleanValue) {
    throw new Error("TLV requires a tag and value");
  }
  const length = cleanValue.length / 2;
  if (length > 255) {
    throw new Error("TLV value exceeds 255 bytes");
  }
  return `${cleanTag}${length.toString(16).padStart(2, "0")}${cleanValue}`;
}

export function parseField55(tlvHex: string): Record<string, string> {
  const clean = normalizeHex(tlvHex);
  const result: Record<string, string> = {};
  let index = 0;

  while (index < clean.length) {
    if (index + 4 > clean.length) break;
    const tag = clean.slice(index, index + 4);
    const lengthHex = clean.slice(index + 4, index + 6);
    const length = parseInt(lengthHex, 16);
    index += 6;
    const value = clean.slice(index, index + length * 2);
    if (!value || value.length !== length * 2) break;
    result[tag] = value;
    index += length * 2;
  }

  return result;
}

export function ensureIsoCurrency(currency: EmvCurrencyCode): string {
  const normalized = String(currency || "840").replace(/\D/g, "") || "840";
  const padded = normalized.padStart(3, "0");
  return padded; // 3-digit ISO currency such as 840 = USD
}

export function amountHex(amountMinor: number): string {
  const cleaned = Math.max(0, Math.floor(amountMinor || 0));
  const width = 6;
  const value = cleaned.toString().padStart(width * 2, "0");
  return value.slice(-width * 2).toUpperCase();
}

export function buildField55(input: EmvField55Input = {}): string {
  const amount = input.amountMinor ?? 1000;
  const currency = ensureIsoCurrency(input.currency ?? "840");
  const aip = normalizeHex(input.aip ?? "8200");
  const cid = normalizeHex(input.cid ?? "80");
  const iad = normalizeHex(input.iad ?? "0102030405");
  const arqc = normalizeHex(input.arqc ?? "A1B2C3D4E5F6071829A0B1C2D3E4F5E6");
  const atc = normalizeHex(input.atc ?? "0001");
  const tvr = normalizeHex(input.tvr ?? "0000000000");
  const date = normalizeHex(input.txnDate ?? "260920");
  const txnType = normalizeHex(input.txnType ?? "00");
  const amountHexValue = normalizeHex(amountHex(amount));
  const amountOtherHex = input.amountOtherMinor === undefined ? null : normalizeHex(amountHex(input.amountOtherMinor));
  const termCountry = normalizeHex(input.terminalCountry ?? "0840");
  const termCapabilities = normalizeHex(input.terminalCapabilities ?? "E0F8C8");
  const cvr = normalizeHex(input.cvr ?? "0102");
  const termType = normalizeHex(input.terminalType ?? "22");
  const ifdSerial = normalizeHex(input.ifdSerial ?? "3132333435363738");
  const aid = normalizeHex(input.aid ?? "A0000000031010");
  const appVersion = normalizeHex(input.appVersion ?? "0101");
  const sequenceCounter = normalizeHex(input.sequenceCounter ?? "00000123");
  const unpredictable = normalizeHex(input.unpredictableNumber ?? input.unpredictable ?? "AABBCCDD");

  return [
    encodeHexTlv("9F26", arqc),
    encodeHexTlv("9F27", cid),
    encodeHexTlv("9F10", iad),
    encodeHexTlv("9F37", unpredictable),
    encodeHexTlv("9F36", atc),
    encodeHexTlv("95", tvr),
    encodeHexTlv("9A", date),
    encodeHexTlv("9C", txnType),
    encodeHexTlv("9F02", amountHexValue),
    ...(amountOtherHex ? [encodeHexTlv("9F03", amountOtherHex)] : []),
    encodeHexTlv("5F2A", currency),
    encodeHexTlv("82", aip),
    encodeHexTlv("9F1A", termCountry),
    encodeHexTlv("9F33", termCapabilities),
    encodeHexTlv("9F34", cvr),
    encodeHexTlv("9F35", termType),
    encodeHexTlv("9F1E", ifdSerial),
    encodeHexTlv("84", aid),
    encodeHexTlv("9F09", appVersion),
    encodeHexTlv("9F41", sequenceCounter),
  ].join("");
}

export function generateDemoArqc(input: EmvField55Input = {}): string {
  const pan = (input.pan || "4111111111111111").replace(/\D/g, "");
  const currency = ensureIsoCurrency(input.currency ?? "840");
  const amount = String(input.amountMinor ?? 1000).padStart(12, "0");
  const terminalId = (input.terminalId || "TID00001").toUpperCase();
  const merchantId = (input.merchantId || "MID000123").toUpperCase();
  const atc = (input.atc || "0001").replace(/\D/g, "").padStart(4, "0");
  const unpredictable = normalizeHex(input.unpredictableNumber ?? input.unpredictable ?? "AABBCCDD");
  const secret = (input.secret || "POS2013-EMV-DEMO-KEY").toUpperCase();

  const seed = [
    secret,
    pan,
    amount,
    currency,
    atc,
    unpredictable,
    terminalId,
    merchantId,
    input.txnType ?? "00",
  ].join("|");

  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16).toUpperCase();
}

export function generateArpc(input: EmvField55Input = {}): string {
  const secret = (input.secret || "POS2013-EMV-DEMO-KEY").toUpperCase();
  const arqc = normalizeHex(input.arqc || generateDemoArqc(input));
  const atc = normalizeHex(input.atc || "0001");
  const amount = String(input.amountMinor ?? 1000).padStart(12, "0");
  const currency = ensureIsoCurrency(input.currency ?? "840");
  const seed = [secret, arqc, atc, amount, currency].join("|");
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16).toUpperCase();
}

export function validateArqc(input: EmvField55Input = {}): { valid: boolean; expectedArqc: string; arpc: string; responseCode: string } {
  const expectedArqc = generateDemoArqc(input);
  const arqc = normalizeHex(input.arqc || expectedArqc);
  const valid = arqc.toUpperCase() === expectedArqc.toUpperCase();
  return {
    valid,
    expectedArqc,
    arpc: generateArpc({ ...input, arqc: arqc }),
    responseCode: valid ? "00" : "AE",
  };
}

export function packIso8583(mti: string, fields: Record<string, string>): { mti: string; fields: Record<string, string>; serialized: string } {
  const ordered = Object.entries(fields).sort(([left], [right]) => Number(left) - Number(right));
  const serialized = ordered
    .map(([fieldId, value]) => `${fieldId.padStart(2, "0")}${String(value.length).padStart(2, "0")}${normalizeHex(value)}`)
    .join("");

  return {
    mti: mti.toUpperCase(),
    fields,
    serialized: `${mti.toUpperCase()}${serialized}`,
  };
}

export function buildAuthorizationRequest(input: EmvField55Input = {}) {
  const mti = "0200";
  const amountMinor = Number(input.amountMinor ?? 1000);
  const currency = ensureIsoCurrency(input.currency ?? "840");
  const expiry = String(input.txnDate || "1230");
  const pan = (input.pan || "4111111111111111").replace(/\D/g, "");
  const atc = (input.atc || "0001").replace(/\D/g, "").padStart(4, "0");
  const unpredictable = normalizeHex(input.unpredictableNumber ?? input.unpredictable ?? "AABBCCDD");
  const arqc = normalizeHex(input.arqc || generateDemoArqc({ ...input, amountMinor, atc, unpredictableNumber: unpredictable }));
  const field55 = buildField55({
    ...input,
    amountMinor,
    currency,
    atc,
    unpredictableNumber: unpredictable,
    arqc,
    terminalCountry: input.terminalCountry ?? "0840",
    terminalId: input.terminalId ?? "TID00001",
    merchantId: input.merchantId ?? "MID000123",
  });

  const iso8583 = packIso8583(mti, {
    "2": pan,
    "3": "000000",
    "4": String(amountMinor).padStart(12, "0"),
    "7": new Date().toISOString().slice(2, 14).replace(/[-:T.]/g, ""),
    "11": String(Math.floor(Math.random() * 900000) + 100000),
    "14": expiry,
    "22": "051",
    "23": "00",
    "25": "00",
    "35": `${pan}=30012345678901234567`,
    "37": `000${Date.now().toString().slice(-9)}`,
    "38": "000000",
    "39": "00",
    "41": input.terminalId ?? "TID00001",
    "42": input.merchantId ?? "MID000123",
    "49": currency,
    "55": field55,
  });

  return { field55, iso8583, arqc };
}

export function buildAuthorizationResponse(input: EmvField55Input = {}) {
  const validation = validateArqc(input);
  const arpc = validation.arpc;
  const approval = validation.valid;
  const response = {
    mti: "0210",
    fields: {
      "2": input.pan || "4111111111111111",
      "3": "000000",
      "4": String(input.amountMinor ?? 1000).padStart(12, "0"),
      "7": new Date().toISOString().slice(2, 14).replace(/[-:T.]/g, ""),
      "11": (input.atc || "0001").replace(/\D/g, "").padStart(6, "0"),
      "38": "000000",
      "39": approval ? "00" : "AE",
      "41": input.terminalId ?? "TID00001",
      "42": input.merchantId ?? "MID000123",
      "49": ensureIsoCurrency(input.currency ?? "840"),
      "55": buildField55({ ...input, arqc: normalizeHex(input.arqc || generateDemoArqc(input)), cid: "80" }),
      "61": arpc,
    },
  };

  return {
    approved: approval,
    arpc,
    responseCode: approval ? "00" : "AE",
    response,
  };
}
