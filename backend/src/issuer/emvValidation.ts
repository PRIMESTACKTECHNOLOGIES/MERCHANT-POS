import { getTag, parseTlv } from "./emvTlv";

export interface EmvData {
  pan: string | null;
  expiry: string | null;
  arqc: Buffer | null;
  cid: Buffer | null;
  atc: Buffer | null;
  unpredictableNumber: Buffer | null;
  amount: Buffer | null;
  currency: Buffer | null;
  terminalCountry: Buffer | null;
  aid: Buffer | null;
  afl: Buffer | null;
  iad: Buffer | null;
  tvr: Buffer | null;
  tsi: Buffer | null;
  aip: Buffer | null;
  cvr: Buffer | null;
  transactionDate: Buffer | null;
  transactionType: Buffer | null;
  terminalCapabilities: Buffer | null;
  terminalType: Buffer | null;
  ifdSerial: Buffer | null;
  appVersion: Buffer | null;
  transactionCounter: Buffer | null;
}

export function parseEmvField55(field55Hex: string): EmvData {
  const normalized = String(field55Hex || "").replace(/\s+/g, "").toUpperCase();
  if (!normalized || !/^[0-9A-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error("EMV_FIELD55_INVALID_HEX");
  }

  const tlvs = parseTlv(Buffer.from(normalized, "hex"));
  const pan = getTag(tlvs, "5A");
  const expiry = getTag(tlvs, "5F24");

  return {
    pan: pan ? pan.toString("hex").toUpperCase().replace(/F+$/, "") : null,
    expiry: expiry ? expiry.toString("hex").toUpperCase() : null,
    arqc: getTag(tlvs, "9F26"),
    cid: getTag(tlvs, "9F27"),
    atc: getTag(tlvs, "9F36"),
    unpredictableNumber: getTag(tlvs, "9F37"),
    amount: getTag(tlvs, "9F02"),
    currency: getTag(tlvs, "5F2A"),
    terminalCountry: getTag(tlvs, "9F1A"),
    aid: getTag(tlvs, "84") || getTag(tlvs, "4F"),
    afl: getTag(tlvs, "94"),
    iad: getTag(tlvs, "9F10"),
    tvr: getTag(tlvs, "95"),
    tsi: getTag(tlvs, "9B"),
    aip: getTag(tlvs, "82"),
    cvr: getTag(tlvs, "9F34"),
    transactionDate: getTag(tlvs, "9A"),
    transactionType: getTag(tlvs, "9C"),
    terminalCapabilities: getTag(tlvs, "9F33"),
    terminalType: getTag(tlvs, "9F35"),
    ifdSerial: getTag(tlvs, "9F1E"),
    appVersion: getTag(tlvs, "9F09"),
    transactionCounter: getTag(tlvs, "9F41"),
  };
}

export function validateEmvField55Minimum(emv: EmvData): void {
  const required: Array<[keyof EmvData, number]> = [
    ["arqc", 8], ["cid", 1], ["iad", 1], ["unpredictableNumber", 4],
    ["atc", 2], ["tvr", 5], ["transactionDate", 3], ["transactionType", 1],
    ["amount", 6], ["currency", 2], ["aip", 2], ["cvr", 1],
  ];
  for (const [name, length] of required) {
    const value = emv[name];
    if (!value || value.length !== length) throw new Error(`EMV_TAG_${String(name).toUpperCase()}_INVALID`);
  }
}

export function validateEmvRisk(emv: EmvData): boolean {
  if (!emv.tvr || emv.tvr.length !== 5 || !emv.tsi || emv.tsi.length !== 2) return false;

  // Reject terminal/card risk flags that must not be overridden by the issuer.
  const terminalRiskFailure = (emv.tvr[0] & 0x80) !== 0 || // offline data authentication failed
    (emv.tvr[1] & 0x80) !== 0 || // expired application
    (emv.tvr[1] & 0x40) !== 0; // application not effective
  return !terminalRiskFailure;
}
