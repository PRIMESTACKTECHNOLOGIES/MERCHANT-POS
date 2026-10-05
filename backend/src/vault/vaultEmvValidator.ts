// vaultEmvValidator.ts — Issuer-side EMV cryptogram validation
import crypto from "crypto";

export interface EmvField55Parsed {
  pan?:               string;
  expiry?:            string;
  iad?:               Buffer;
  arqc?:              Buffer;
  cryptogramType?:    Buffer;
  atc?:               number;
  unpredictableNumber?: Buffer;
  tvr?:               Buffer;
  tsi?:               Buffer;
  aip?:               Buffer;
  amountMinor?:       number;
  currencyCode?:      string;
}

export function parseEmvField55(hex: string): EmvField55Parsed {
  const src = hex.toUpperCase().replace(/\s/g, "");
  const result: EmvField55Parsed = {};
  let i = 0;
  while (i < src.length - 4) {
    let tag: string;
    const fb = parseInt(src.slice(i, i + 2), 16);
    if ((fb & 0x1F) === 0x1F) { tag = src.slice(i, i + 4); i += 4; }
    else                       { tag = src.slice(i, i + 2); i += 2; }
    if (i + 2 > src.length) break;
    const len = parseInt(src.slice(i, i + 2), 16);
    i += 2;
    if (i + len * 2 > src.length) break;
    const val = Buffer.from(src.slice(i, i + len * 2), "hex");
    i += len * 2;
    switch (tag) {
      case "5A":   result.pan              = val.toString("hex").replace(/f$/i, ""); break;
      case "5F24": result.expiry           = val.toString("hex"); break;
      case "9F10": result.iad              = val; break;
      case "9F26": result.arqc             = val; break;
      case "9F27": result.cryptogramType   = val; break;
      case "9F36": result.atc              = (val[0] << 8) | val[1]; break;
      case "9F37": result.unpredictableNumber = val; break;
      case "95":   result.tvr              = val; break;
      case "9B":   result.tsi              = val; break;
      case "82":   result.aip              = val; break;
      case "9F02": result.amountMinor      = parseInt(val.toString("hex"), 16); break;
      case "5F2A": result.currencyCode     = val.toString("hex"); break;
    }
  }
  return result;
}

export function validateVaultEmv(
  field55Hex: string,
  card: { pan: string; atc: number },
  amountMinor: number,
  currencyCode: string
): { valid: boolean; reason?: string } {
  let emv: EmvField55Parsed;
  try { emv = parseEmvField55(field55Hex); } catch {
    return { valid: false, reason: "EMV_PARSE_ERROR" };
  }

  if (!emv.arqc)              return { valid: false, reason: "EMV_ARQC_MISSING" };
  if (!emv.iad)               return { valid: false, reason: "EMV_IAD_MISSING" };
  if (!emv.tvr)               return { valid: false, reason: "EMV_TVR_MISSING" };
  if (emv.atc === undefined)  return { valid: false, reason: "EMV_ATC_MISSING" };

  const un     = emv.unpredictableNumber || Buffer.alloc(4);
  const atcBuf = Buffer.from([emv.atc >> 8, emv.atc & 0xff]);

  const recomputed = crypto.createHash("sha256")
    .update(card.pan)
    .update(atcBuf)
    .update(Buffer.from(String(amountMinor)))
    .update(Buffer.from(currencyCode))
    .update(un)
    .digest()
    .subarray(0, 8);

  if (!recomputed.equals(emv.arqc))
    return { valid: false, reason: "EMV_CRYPTOGRAM_INVALID" };

  return { valid: true };
}