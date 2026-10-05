import { Iso8583Codec, type IsoMessage } from "../domain/payments/acquirer/iso8583.codec";
import { isoProfile } from "../domain/payments/acquirer/iso8583.profile";

export type IssuerRequest = {
  panToken: string;
  processingCode: string;
  amountMinor: number;
  transmissionDateTime: string;
  stan: string;
  expiry?: string;
  posEntryMode: string;
  panSequence?: string;
  posConditionCode: string;
  track2Token?: string;
  rrn: string;
  terminalId: string;
  merchantId: string;
  currencyCode: string;
  field55Hex: string;
};

const codec = new Iso8583Codec({
  ...isoProfile,
  70: { type: "N", length: 3, variable: "FIXED", encoding: "ascii" },
});

function digits(value: string, length: number, name: string): string {
  if (!new RegExp(`^\\d{${length}}$`).test(value)) throw new Error(`${name}_INVALID`);
  return value;
}

function validateHex(value: string): Buffer {
  const clean = String(value || "").replace(/\s+/g, "").toUpperCase();
  if (!clean || clean.length % 2 !== 0 || !/^[0-9A-F]+$/.test(clean)) throw new Error("DE55_INVALID_HEX");
  return Buffer.from(clean, "hex");
}

export function build0200(request: IssuerRequest): IsoMessage {
  if (!request.panToken || request.panToken.length > 512) throw new Error("TOKENIZED_PAN_REQUIRED");
  if (!Number.isSafeInteger(request.amountMinor) || request.amountMinor < 0) throw new Error("AMOUNT_INVALID");
  digits(request.processingCode, 6, "PROCESSING_CODE");
  digits(request.transmissionDateTime, 10, "TRANSMISSION_DATE_TIME");
  digits(request.stan, 6, "STAN");
  digits(request.posEntryMode, 3, "POS_ENTRY_MODE");
  digits(request.posConditionCode, 2, "POS_CONDITION_CODE");
  digits(request.currencyCode, 3, "CURRENCY_CODE");
  const field55 = validateHex(request.field55Hex);
  const fields: IsoMessage["fields"] = {
    2: request.panToken,
    3: request.processingCode,
    4: String(request.amountMinor).padStart(12, "0"),
    7: request.transmissionDateTime,
    11: request.stan,
    22: request.posEntryMode,
    23: request.panSequence || "001",
    25: request.posConditionCode,
    37: request.rrn,
    41: request.terminalId,
    42: request.merchantId,
    49: request.currencyCode,
    55: field55,
  };
  if (request.expiry) fields[14] = request.expiry;
  if (request.track2Token) fields[35] = request.track2Token;
  return {
    mti: "0200",
    fields,
  };
}

export function build0210(request: IsoMessage, responseCode: string, authCode?: string, field55Hex?: string): IsoMessage {
  if (request.mti !== "0200") throw new Error("REQUEST_MTI_MUST_BE_0200");
  const fields: IsoMessage["fields"] = {
    2: request.fields[2] || "",
    4: request.fields[4] || "",
    11: request.fields[11] || "",
    39: responseCode,
  };
  if (authCode) fields[38] = authCode;
  if (field55Hex) fields[55] = validateHex(field55Hex);
  return { mti: "0210", fields };
}

export function build0420(request: IssuerRequest): IsoMessage {
  return { ...build0200(request), mti: "0420" };
}

export function build0430(request: IsoMessage, responseCode: string): IsoMessage {
  if (request.mti !== "0420") throw new Error("REQUEST_MTI_MUST_BE_0420");
  return { mti: "0430", fields: { 11: request.fields[11] || "", 37: request.fields[37] || "", 39: responseCode } };
}

export function build0800(stan: string, transmissionDateTime: string, networkCode = "001"): IsoMessage {
  return { mti: "0800", fields: { 7: digits(transmissionDateTime, 10, "TRANSMISSION_DATE_TIME"), 11: digits(stan, 6, "STAN"), 70: digits(networkCode, 3, "NETWORK_CODE") } };
}

export function build0810(request: IsoMessage, responseCode = "00"): IsoMessage {
  if (request.mti !== "0800") throw new Error("REQUEST_MTI_MUST_BE_0800");
  return { mti: "0810", fields: { 7: request.fields[7] || "", 11: request.fields[11] || "", 39: responseCode, 70: request.fields[70] || "001" } };
}

export function packIssuerMessage(message: IsoMessage): Buffer {
  return codec.pack(message);
}

export function unpackIssuerMessage(raw: Buffer): IsoMessage {
  return codec.unpack(raw);
}
