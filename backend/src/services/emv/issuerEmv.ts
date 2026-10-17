/**
 * issuerEmv.ts — EMV card-side generator and issuer-side validator for wallet
 * cards.
 *
 * Every cryptogram produced here comes from the real EMV key schedule in
 * issuer/issuerCrypto.ts:
 *
 *   IMK → UDK (PAN ‖ PSN) → session key (ATC) → ISO 9797-1 Alg 3 retail MAC
 *
 * and every DOL is built from the single application profile in
 * issuer/emvCdol.ts, so the terminal, the card and the issuer MAC exactly the
 * same bytes. Without that the ARQC would never verify on a real card (a length
 * mismatch is answered with status word 6700).
 *
 * The issuer master key must be configured (EMV_ISSUER_MASTER_KEY_HEX, 16 or 24
 * bytes of hex). When it is missing this module throws rather than emitting a
 * cryptogram it cannot back.
 */

import { parseTlv } from "../../issuer/emvTlv";
import { SoftwareEmvIssuerCrypto } from "../../issuer/issuerCrypto";
import {
  AFL_HEX,
  AIP_HEX,
  CDOL1_HEX,
  buildDolData,
  currencyToBcd,
  encodeBcdAmount,
  missingDolTags,
} from "../../issuer/emvCdol";
import {
  build0200,
  build0210,
  packIssuerMessage,
  type IssuerRequest,
} from "../../iso8583/issuerMessages";

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
  panSequence?: string;
  expiry?: string;        // "MM/YY" or "YYMM"
  terminalId?: string;
  merchantId?: string;
  stan?: string;
  rrn?: string;
  secret?: string;
  /** 2-character ISO 8583 DE39 sent back inside tag 91 (default "00"). */
  responseCode?: string;
}

/** Strip decoration and uppercase. NOTE: does not validate even-length. */
export function normalizeHex(value: string): string {
  return (value || "").replace(/0x/i, "").replace(/\s+/g, "").toUpperCase();
}

function requireEvenHex(value: string, name: string): string {
  const clean = normalizeHex(value);
  if (!clean || clean.length % 2 !== 0 || !/^[0-9A-F]+$/.test(clean)) {
    throw new Error(`${name}_MUST_BE_EVEN_LENGTH_HEX`);
  }
  return clean;
}

/**
 * Encode one BER-TLV element. Lengths above 255 bytes use the 0x81 form.
 * Values must be whole bytes — an odd nibble count would desynchronise the
 * whole block.
 */
export function encodeHexTlv(tagHex: string, valueHex: string): string {
  const cleanTag = requireEvenHex(tagHex, "TLV_TAG");
  const cleanValue = requireEvenHex(valueHex, "TLV_VALUE");
  const length = cleanValue.length / 2;
  if (length > 0xff) {
    return `${cleanTag}81${length.toString(16).padStart(2, "0").toUpperCase()}${cleanValue}`;
  }
  return `${cleanTag}${length.toString(16).padStart(2, "0").toUpperCase()}${cleanValue}`;
}

/**
 * Parse a Field 55 block into `tag → hex value`.
 *
 * Uses the shared BER-TLV parser: tags are 1 or 2 bytes depending on the
 * constructed bit of the first byte, so tags such as 95 / 9A / 9C / 82 / 84
 * (single byte) and 9F26 / 9F36 (two bytes) are both read correctly.
 */
export function parseField55(tlvHex: string): Record<string, string> {
  const clean = normalizeHex(tlvHex);
  if (!clean) return {};
  const out: Record<string, string> = {};
  for (const element of parseTlv(Buffer.from(clean, "hex"))) {
    out[element.tag] = element.value.toString("hex").toUpperCase();
  }
  return out;
}

/** ISO 4217 numeric currency, 3 digits, e.g. "840". */
export function ensureIsoCurrency(currency: EmvCurrencyCode): string {
  const normalized = String(currency || "840").replace(/\D/g, "") || "840";
  return normalized.padStart(3, "0").slice(-3);
}

/**
 * Amount in minor units as 6-byte BCD (n12) for tag 9F02 / DE4.
 * Encoding the decimal string as raw hex would produce a different number.
 */
export function amountHex(amountMinor: number): string {
  return encodeBcdAmount(Math.max(0, Math.floor(amountMinor || 0)));
}

/** n6 expiry (YYMMDD, last day of month) for tag 5F24. */
function expiryToBcd(expiry?: string): string | null {
  const raw = String(expiry || "").replace(/\D/g, "");
  let yy: string;
  let mm: string;
  if (raw.length === 4) {
    yy = raw.slice(0, 2);
    mm = raw.slice(2, 4);
  } else if (raw.length === 5) {
    mm = raw.slice(0, 2);
    yy = raw.slice(3, 5);
  } else {
    return null;
  }
  const month = Number(mm);
  if (month < 1 || month > 12) return null;
  const lastDay = new Date(2000 + Number(yy), month, 0).getDate();
  return `${yy}${mm}${String(lastDay).padStart(2, "0")}`;
}

/** PAN as n..19 BCD, right-padded with 'F' to a whole byte (tag 5A). */
function panToBcd(pan: string): string {
  const digits = String(pan || "").replace(/\D/g, "");
  return digits.length % 2 === 1 ? `${digits}F` : digits;
}

interface Cdol1Input {
  pan: string;
  panSequence: string;
  atc: string;
  amountHex: string;
  amountOtherHex: string;
  terminalCountry: string;
  tvr: string;
  currencyBcd: string;
  txnDate: string;
  txnType: string;
  unpredictable: string;
  iad: string;
  cdol1Hex: string;
  missing: string[];
}

/** Collect everything the CDOL1 MAC depends on, once, for every code path. */
function cdol1Input(input: EmvField55Input): Cdol1Input {
  const pan = String(input.pan || "").replace(/\D/g, "");
  if (pan.length < 13 || pan.length > 19) throw new Error("PAN_LENGTH_INVALID");

  const amountMinor = Number(input.amountMinor ?? 1000);
  const values = {
    "9F02": amountHex(amountMinor),
    "9F03": amountHex(Number(input.amountOtherMinor ?? 0)),
    "9F1A": normalizeHex(input.terminalCountry ?? "0840"),
    "95": normalizeHex(input.tvr ?? "0000000000"),
    "5F2A": currencyToBcd(ensureIsoCurrency(input.currency ?? "840")),
    "9A": normalizeHex(input.txnDate ?? new Date().toISOString().slice(2, 10).replace(/-/g, "")),
    "9C": normalizeHex(input.txnType ?? "00"),
    "9F37": normalizeHex(input.unpredictableNumber ?? input.unpredictable ?? "AABBCCDD"),
    "9F36": normalizeHex(input.atc ?? "0001").padStart(4, "0"),
    "9F10": normalizeHex(input.iad ?? "0700000000000000"),
  };

  return {
    pan,
    panSequence: String(input.panSequence ?? "00").padStart(2, "0"),
    atc: values["9F36"],
    amountHex: values["9F02"],
    amountOtherHex: values["9F03"],
    terminalCountry: values["9F1A"],
    tvr: values["95"],
    currencyBcd: values["5F2A"],
    txnDate: values["9A"],
    txnType: values["9C"],
    unpredictable: values["9F37"],
    iad: values["9F10"],
    cdol1Hex: buildDolData(CDOL1_HEX, values),
    missing: missingDolTags(CDOL1_HEX, values),
  };
}

/**
 * Compute the ARQC the card would return for this transaction data.
 * This is the card side of the exchange — the value is the real retail MAC
 * over CDOL1 under the card's session key.
 */
export function generateIssuerArqc(input: EmvField55Input = {}): string {
  const ctx = cdol1Input(input);
  if (ctx.missing.length) throw new Error(`EMV_CDOL1_TAG_MISSING:${ctx.missing.join(",")}`);
  return SoftwareEmvIssuerCrypto.fromEnvironment().generate({
    pan: ctx.pan,
    panSequence: ctx.panSequence,
    atc: ctx.atc,
    cdol1Hex: ctx.cdol1Hex,
  }).arqc;
}

/**
 * Derive the ARPC the card verifies after the online response.
 * `responseCode` (DE39) is folded into the ARPC per EMV Book 3, so the card
 * learns the issuer's decision from the cryptogram itself.
 */
export function generateArpc(input: EmvField55Input = {}): string {
  const ctx = cdol1Input(input);
  const arqc = requireEvenHex(input.arqc || generateIssuerArqc(input), "ARQC");
  if (arqc.length !== 16) throw new Error("ARQC_MUST_BE_8_BYTES");
  return SoftwareEmvIssuerCrypto.fromEnvironment().generateArpc({
    pan: ctx.pan,
    panSequence: ctx.panSequence,
    atc: ctx.atc,
    cdol1Hex: ctx.cdol1Hex,
    arqc,
    responseCode: input.responseCode || "00",
  });
}

/**
 * Issuer-side ARQC validation. Recomputes the cryptogram from the presented
 * transaction data and compares in constant time. No ARPC is issued for a
 * cryptogram that cannot be proven.
 */
export function validateArqc(input: EmvField55Input = {}): {
  valid: boolean;
  arpc: string;
  responseCode: string;
  reason?: string;
} {
  const presented = normalizeHex(input.arqc || "");
  if (presented.length !== 16) {
    return { valid: false, arpc: "", responseCode: "05", reason: "EMV_ARQC_INVALID_LENGTH" };
  }

  let ctx: Cdol1Input;
  try {
    ctx = cdol1Input(input);
  } catch (err: any) {
    return { valid: false, arpc: "", responseCode: "05", reason: err?.message || "EMV_INPUT_INVALID" };
  }
  if (ctx.missing.length) {
    return { valid: false, arpc: "", responseCode: "05", reason: `EMV_CDOL1_TAG_MISSING:${ctx.missing.join(",")}` };
  }

  try {
    SoftwareEmvIssuerCrypto.fromEnvironment().validate({
      pan: ctx.pan,
      panSequence: ctx.panSequence,
      atc: ctx.atc,
      cdol1Hex: ctx.cdol1Hex,
      arqc: presented,
    });
  } catch (err: any) {
    return {
      valid: false,
      arpc: "",
      responseCode: "05",
      reason: err?.message === "EMV_ARQC_INVALID" ? "EMV_CRYPTOGRAM_INVALID" : err?.message || "EMV_CRYPTO_ERROR",
    };
  }

  return {
    valid: true,
    arpc: generateArpc({ ...input, arqc: presented, responseCode: "00" }),
    responseCode: "00",
  };
}

/**
 * Build the card's Field 55 block (DE55) with every tag a real kernel needs,
 * including AIP (82) and AFL (94).
 */
export function buildField55(input: EmvField55Input = {}): string {
  const ctx = cdol1Input(input);
  if (ctx.missing.length) throw new Error(`EMV_CDOL1_TAG_MISSING:${ctx.missing.join(",")}`);

  const arqc = requireEvenHex(input.arqc || generateIssuerArqc(input), "ARQC");
  if (arqc.length !== 16) throw new Error("ARQC_MUST_BE_8_BYTES");

  const expiry = expiryToBcd(input.expiry);
  const parts = [
    encodeHexTlv("5A", panToBcd(ctx.pan)),
    ...(expiry ? [encodeHexTlv("5F24", expiry)] : []),
    encodeHexTlv("5F34", ctx.panSequence),
    encodeHexTlv("82", normalizeHex(input.aip ?? AIP_HEX)),
    encodeHexTlv("94", normalizeHex(AFL_HEX)),
    encodeHexTlv("9F26", arqc),
    encodeHexTlv("9F27", normalizeHex(input.cid ?? "80")),
    encodeHexTlv("9F10", ctx.iad),
    encodeHexTlv("9F37", ctx.unpredictable),
    encodeHexTlv("9F36", ctx.atc),
    encodeHexTlv("95", ctx.tvr),
    encodeHexTlv("9A", ctx.txnDate),
    encodeHexTlv("9C", ctx.txnType),
    encodeHexTlv("9F02", ctx.amountHex),
    encodeHexTlv("9F03", ctx.amountOtherHex),
    encodeHexTlv("5F2A", ctx.currencyBcd),
    encodeHexTlv("9F1A", ctx.terminalCountry),
    encodeHexTlv("9F33", normalizeHex(input.terminalCapabilities ?? "E0F8C8")),
    encodeHexTlv("9F34", normalizeHex(input.cvr ?? "0102")),
    encodeHexTlv("9F35", normalizeHex(input.terminalType ?? "22")),
    ...(input.ifdSerial ? [encodeHexTlv("9F1E", normalizeHex(input.ifdSerial))] : []),
    encodeHexTlv("84", normalizeHex(input.aid ?? "A0000000031010")),
    encodeHexTlv("9F09", normalizeHex(input.appVersion ?? "008C")),
    encodeHexTlv("9F41", normalizeHex(input.sequenceCounter ?? "00000100")),
  ];
  return parts.join("");
}

function transmissionDateTime(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
}

function issuerRequest(input: EmvField55Input, field55: string): IssuerRequest {
  const pan = String(input.pan || "").replace(/\D/g, "");
  const expiry = expiryToBcd(input.expiry);
  return {
    panToken: pan,
    processingCode: "000000",
    amountMinor: Number(input.amountMinor ?? 1000),
    transmissionDateTime: transmissionDateTime(),
    stan: input.stan || String(Math.floor(Math.random() * 900000) + 100000),
    expiry: expiry ? `${expiry.slice(2, 4)}${expiry.slice(0, 2)}` : undefined,   // YYMM
    posEntryMode: "051",        // chip, contactless capable
    panSequence: String(input.panSequence ?? "00").padStart(3, "0"),
    posConditionCode: "00",
    rrn: input.rrn || String(Date.now()).slice(-12).padStart(12, "0"),
    terminalId: input.terminalId || "TID00001",
    merchantId: input.merchantId || "MID000123",
    currencyCode: ensureIsoCurrency(input.currency ?? "840"),
    field55Hex: field55,
  };
}

/** Build a real ISO 8583 0200 authorization request carrying DE55. */
export function buildAuthorizationRequest(input: EmvField55Input = {}) {
  const arqc = normalizeHex(input.arqc || generateIssuerArqc(input));
  const field55 = buildField55({ ...input, arqc });
  const message = build0200(issuerRequest(input, field55));
  return {
    field55,
    arqc,
    iso8583: packIssuerMessage(message).toString("hex").toUpperCase(),
    iso8583Fields: message.fields,
  };
}

/**
 * Build the ISO 8583 0210 authorization response.
 *
 * The issuer's answer reaches the card inside DE55 as tag 91 (Issuer
 * Authentication Data) = ARPC (8 bytes) ‖ ARC (2 bytes), which is what the card
 * verifies on the second GENERATE AC.
 */
export function buildAuthorizationResponse(input: EmvField55Input = {}) {
  const validation = validateArqc(input);
  const arc = validation.responseCode;

  // Tag 91 = ARPC ‖ ARC: the issuer's decision, cryptographically bound.
  const responseField55 = encodeHexTlv("91", `${validation.arpc}${Buffer.from(arc, "ascii").toString("hex")}`);

  const requestField55 = buildField55({
    ...input,
    arqc: normalizeHex(input.arqc || generateIssuerArqc(input)),
  });
  const response0210 = build0210(
    build0200(issuerRequest(input, requestField55)),
    arc,
    validation.valid ? String(input.stan || "000000") : undefined,
    responseField55,
  );

  return {
    approved: validation.valid,
    arpc: validation.arpc,
    responseCode: arc,
    reason: validation.reason,
    field55: responseField55,
    iso8583: packIssuerMessage(response0210).toString("hex").toUpperCase(),
    iso8583Fields: response0210.fields,
  };
}
