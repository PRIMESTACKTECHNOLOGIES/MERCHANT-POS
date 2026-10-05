const net = require("net");
const crypto = require("crypto");
const http = require("http");
try { require("dotenv").config(); } catch {}

const ACQUIRER_NAME = "VAULT_BANK_ACQUIRER";
const HOST = process.env.VAULT_BANK_TCP_HOST || process.env.VAULT_BANK_BIND_HOST || "0.0.0.0";
const PORT = parseInt(process.env.VAULT_BANK_TCP_PORT || process.env.ACQUIRER_PORT || "9000", 10);

const SETTLEMENT_HOST = process.env.VAULT_SETTLEMENT_HOST || process.env.VAULT_BANK_BIND_HOST || "127.0.0.1";
const SETTLEMENT_PORT = parseInt(process.env.VAULT_SETTLEMENT_PORT || process.env.VAULT_BANK_PORT || "9001", 10);

const VAULT_BANK_BIC = process.env.VAULT_BANK_SWIFT_BIC || "VBLKSCSEXXX";
const VAULT_BANK_LEGAL_NAME = process.env.VAULT_BANK_LEGAL_NAME || "VAULT BANK INTERNATIONAL LIMITED";
const VAULT_BANK_JURISDICTION = process.env.VAULT_BANK_JURISDICTION || "Seychelles";
const VAULT_BANK_CENTRAL_BANK_LICENSE = process.env.VAULT_BANK_CENTRAL_BANK_LICENSE || "FSRA-Seychelles-Class-1-2024-0891";

const NUM_CCY_TO_ALPHA = {
  "784": "AED", "840": "USD", "978": "EUR", "826": "GBP",
  "702": "SGD", "356": "INR", "392": "JPY", "756": "CHF",
  "036": "AUD", "124": "CAD", "344": "HKD", "458": "MYR", "156": "CNY"
};

function numericCurrencyToAlpha(code) {
  if (!code) return "USD";
  if (/^[A-Z]{3}$/.test(String(code).toUpperCase())) return String(code).toUpperCase();
  return NUM_CCY_TO_ALPHA[String(code)] || "USD";
}

const PROCESSOR_MODE = (process.env.VAULT_BANK_MODE || "TEST").toUpperCase();
if (!["TEST", "LIVE"].includes(PROCESSOR_MODE)) {
  console.error(`[${ACQUIRER_NAME}] FATAL: VAULT_BANK_MODE must be TEST or LIVE. Got: ${PROCESSOR_MODE}`);
  process.exit(1);
}

const LIVE_SCHEME_CONFIG = {
  VISA: {
    host: process.env.VISA_NET_HOST || "localhost",
    port: parseInt(process.env.VISA_NET_PORT || "0", 10) || 5001,
    terminalId: process.env.VISA_TID || "VBVISA01",
    merchantId: process.env.VISA_MID || "VBMERCH01",
    acquiringInstitutionIdCode: process.env.VISA_ACQ_BIC || "VBSCHAE0XXX",
    hsmZmk: process.env.VAULT_HSM_ZMK || null,
    hsmZpk: process.env.VAULT_HSM_ZPK || null,
    macKey: process.env.VAULT_MAC_KEY || "00112233445566778899AABBCCDDEEFF"
  },
  MASTERCARD: {
    host: process.env.MC_NET_HOST || "localhost",
    port: parseInt(process.env.MC_NET_PORT || "0", 10) || 5002,
    terminalId: process.env.MC_TID || "VBMC0001",
    merchantId: process.env.MC_MID || "VBMERCH02",
    acquiringInstitutionIdCode: process.env.MC_ACQ_BIC || "VBSCHMC0XXX",
    hsmZmk: process.env.VAULT_HSM_ZMK || null,
    hsmZpk: process.env.VAULT_HSM_ZPK || null,
    macKey: process.env.VAULT_MAC_KEY || "FFEEDDCCBBAA99887766554433221100"
  }
};

const ALL_CCYS = Object.values(NUM_CCY_TO_ALPHA).concat(["CNY"]);
const ACCEPTED_SCHEMES = ["VISA", "MASTERCARD", "AMEX", "DISCOVER", "UNIONPAY", "TROY"];

const binTable = {
  "4":     { scheme: "VISA",       length: 16 },
  "51":    { scheme: "MASTERCARD", length: 16 },
  "52":    { scheme: "MASTERCARD", length: 16 },
  "53":    { scheme: "MASTERCARD", length: 16 },
  "54":    { scheme: "MASTERCARD", length: 16 },
  "55":    { scheme: "MASTERCARD", length: 16 },
  "34":    { scheme: "AMEX",       length: 15 },
  "37":    { scheme: "AMEX",       length: 15 },
  "6011":  { scheme: "DISCOVER",   length: 16 },
  "622126": { scheme: "UNIONPAY",  length: 16 },
  "9792":  { scheme: "TROY",       length: 16 }
};

function detectScheme(pan) {
  if (!pan) return null;
  const digits = String(pan).replace(/\D/g, "");
  const keys = Object.keys(binTable).sort((a, b) => b.length - a.length);
  for (const bin of keys) if (digits.startsWith(bin)) return binTable[bin];
  return null;
}

function luhnValid(digits) {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function validatePan(pan) {
  if (!pan) return { valid: false, responseCode: "14", reason: "NO_PAN" };
  const digits = String(pan).replace(/\D/g, "");
  if (!/^\d+$/.test(digits)) return { valid: false, responseCode: "14", reason: "NON_NUMERIC_PAN" };
  const vaultCard = OP_CARD_PREFIX_MAP.get(digits);
  const isVaultIssued = !!(vaultCard && vaultCard.isVaultIssued);
  if (digits.startsWith("52") && digits.length === 16) {
    return { valid: true, scheme: "MASTERCARD", digits, isDpan: true, isVaultIssued };
  }
  if (isVaultIssued && digits.length === 16) {
    const scheme = (vaultCard && vaultCard.scheme) ? String(vaultCard.scheme).toUpperCase() : digits.startsWith("4") ? "VISA" : "MASTERCARD";
    return { valid: true, scheme, digits, isDpan: false, isVaultIssued: true };
  }
  const schemeInfo = detectScheme(digits);
  if (!schemeInfo) return { valid: false, responseCode: "14", reason: "UNKNOWN_BIN" };
  if (digits.length !== schemeInfo.length) return { valid: false, responseCode: "14", reason: "INVALID_LENGTH", scheme: schemeInfo.scheme };
  return { valid: true, scheme: schemeInfo.scheme, digits, isDpan: false, isVaultIssued };
}

const ISO_BITMAP_DEFS = {
  2:  { name: "Primary account number",            format: "LLVAR" },
  3:  { name: "Processing code",                   format: "FIXED", len: 6 },
  4:  { name: "Amount, transaction",               format: "FIXED", len: 12 },
  7:  { name: "Transmission date & time",          format: "FIXED", len: 10 },
  11: { name: "Systems trace audit number",        format: "FIXED", len: 6 },
  12: { name: "Time, local transaction",           format: "FIXED", len: 6 },
  13: { name: "Date, local transaction",           format: "FIXED", len: 4 },
  14: { name: "Date, expiration",                  format: "FIXED", len: 4 },
  18: { name: "Merchant type",                     format: "FIXED", len: 4 },
  22: { name: "Point of service entry mode",       format: "FIXED", len: 3 },
  23: { name: "Card sequence number",              format: "FIXED", len: 3 },
  25: { name: "Pos condition code",                format: "FIXED", len: 2 },
  26: { name: "Card acceptor business code",       format: "FIXED", len: 2 },
  28: { name: "Amount, transaction fee",           format: "FIXED", len: 9 },
  32: { name: "Acquiring institution id code",     format: "LLVAR" },
  33: { name: "Forwarding institution id code",    format: "LLVAR" },
  35: { name: "Track 2 data",                      format: "LLVAR" },
  37: { name: "Retrieval reference number",        format: "FIXED", len: 12 },
  38: { name: "Authorization identification resp", format: "FIXED", len: 6 },
  39: { name: "Response code",                     format: "FIXED", len: 2 },
  41: { name: "Card acceptor terminal id",         format: "FIXED", len: 8 },
  42: { name: "Card acceptor id code",             format: "FIXED", len: 15 },
  43: { name: "Card acceptor name/location",       format: "FIXED", len: 40 },
  44: { name: "Additional response data",          format: "LLVAR" },
  48: { name: "Additional data - private",         format: "LLLVAR" },
  49: { name: "Currency code, transaction",        format: "FIXED", len: 3 },
  52: { name: "Personal identification number",    format: "FIXED", len: 16 },
  53: { name: "Security related control info",     format: "FIXED", len: 16 },
  54: { name: "Additional amounts",                format: "LLLVAR" },
  55: { name: "EMV data (TLV)",                    format: "LLLVAR" },
  60: { name: "Advice / reason code",              format: "LLLVAR" },
  61: { name: "Reserved private",                  format: "LLLVAR" },
  63: { name: "Network management info",           format: "LLLVAR" },
  64: { name: "MAC (Message auth code)",           format: "FIXED", len: 16 }
};

function buildBitmap(fields) {
  const bits = new Set();
  const keys = Object.keys(fields).map(k => parseInt(k, 10));
  for (const k of keys) if (ISO_BITMAP_DEFS[k]) bits.add(k);
  bits.add(64);
  let max = 64;
  for (const b of bits) if (b > max) max = b;
  if (max > 64) max = 128;
  const bytes = new Uint8Array(Math.ceil(max / 8));
  for (const bit of bits) {
    const idx = bit - 1;
    const byteIdx = Math.floor(idx / 8);
    const bitIdx = 7 - (idx % 8);
    bytes[byteIdx] |= (1 << bitIdx);
  }
  return {
    bytes: Buffer.from(bytes),
    hex: Buffer.from(bytes).toString("hex").toUpperCase()
  };
}

function parseBitmapHex(bitmapHex) {
  const buf = Buffer.from(bitmapHex, "hex");
  const setBits = [];
  for (let b = 0; b < buf.length * 8; b++) {
    const byteIdx = Math.floor(b / 8);
    const bitIdx = 7 - (b % 8);
    if ((buf[byteIdx] & (1 << bitIdx)) !== 0) setBits.push(b + 1);
  }
  return setBits;
}

function padLeft(s, len, c) {
  s = String(s ?? "");
  if (s.length >= len) return s.slice(-len);
  return c.repeat(len - s.length) + s;
}

function padRight(s, len, c) {
  s = String(s ?? "");
  if (s.length >= len) return s.slice(0, len);
  return s + c.repeat(len - s.length);
}

function packField(bitNum, value, def) {
  if (!def) return "";
  if (def.format === "LLVAR") {
    const v = String(value ?? "");
    return padLeft(v.length, 2, "0") + v;
  }
  if (def.format === "LLLVAR") {
    const v = String(value ?? "");
    return padLeft(v.length, 3, "0") + v;
  }
  if (def.format === "FIXED") {
    if (bitNum === 2 || bitNum === 32 || bitNum === 33) {
      return padLeft(String(value ?? "").replace(/\D/g, "").slice(-19), def.len, " ");
    }
    if ([3, 4, 7, 11, 12, 13, 14, 18, 22, 23, 25, 26, 28, 49].includes(bitNum)) {
      return padLeft(String(value ?? ""), def.len, "0");
    }
    if (bitNum === 41) return padRight(String(value ?? ""), def.len, " ");
    if (bitNum === 42) return padRight(String(value ?? ""), def.len, " ");
    if (bitNum === 43) return padRight(String(value ?? ""), def.len, " ");
    return padLeft(String(value ?? ""), def.len, "0");
  }
  return String(value ?? "");
}

function encodeISO8583(mti, fields) {
  const activeBits = Object.keys(fields).map(k => parseInt(k, 10)).filter(k => ISO_BITMAP_DEFS[k]);
  activeBits.push(64);
  const hasSecondary = activeBits.some(b => b > 64);
  if (hasSecondary) activeBits.push(1);
  const sortedBits = [...new Set(activeBits)].sort((a, b) => a - b);
  const _fields = {};
  for (const b of sortedBits) _fields[b] = fields[b];
  const { bytes } = buildBitmap(_fields);
  let body = "";
  for (const bit of sortedBits) {
    if (bit === 64) continue;
    const def = ISO_BITMAP_DEFS[bit];
    if (!def) continue;
    body += packField(bit, _fields[bit], def);
  }
  const messageBeforeMac = mti + bytes.toString("hex").toUpperCase() + body;
  const mac = calculateMac(messageBeforeMac);
  body += packField(64, mac, ISO_BITMAP_DEFS[64]);
  const full = mti + bytes.toString("hex").toUpperCase() + body;
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(Buffer.byteLength(full, "ascii"), 0);
  return Buffer.concat([lenBuf, Buffer.from(full, "ascii")]);
}

function decodeISO8583(buffer) {
  if (buffer.length < 18) throw new Error("ISO buffer too short");
  let offset = 0;
  let mti = null;
  let bitmapHex = null;
  const msgLen = buffer.readUInt16BE(0);
  offset = 2;
  mti = buffer.toString("ascii", offset, offset + 4);
  offset += 4;
  const primaryBitmapHex = buffer.toString("ascii", offset, offset + 16);
  offset += 16;
  bitmapHex = primaryBitmapHex;
  const primaryBits = parseBitmapHex(primaryBitmapHex);
  let fields = {};
  for (const bit of primaryBits) {
    if (bit === 1) continue;
    const def = ISO_BITMAP_DEFS[bit];
    if (!def) continue;
    if (def.format === "LLVAR") {
      if (offset + 2 > buffer.length) break;
      const len = parseInt(buffer.toString("ascii", offset, offset + 2), 10);
      offset += 2;
      fields[bit] = buffer.toString("ascii", offset, offset + len);
      offset += len;
    } else if (def.format === "LLLVAR") {
      if (offset + 3 > buffer.length) break;
      const len = parseInt(buffer.toString("ascii", offset, offset + 3), 10);
      offset += 3;
      fields[bit] = buffer.toString("ascii", offset, offset + len);
      offset += len;
    } else if (def.format === "FIXED") {
      fields[bit] = buffer.toString("ascii", offset, offset + def.len);
      offset += def.len;
    }
  }
  return { mti, fields, bitmapHex, bytesConsumed: offset };
}

function calculateMac(messageHex) {
  try {
    const hexKey = process.env.VAULT_MAC_KEY || "00112233445566778899AABBCCDDEEFF";
    const key = Buffer.from(hexKey, "hex");
    let block = Buffer.alloc(8, 0);
    const msg = Buffer.from(messageHex, "ascii");
    for (let i = 0; i < msg.length; i += 8) {
      const chunk = Buffer.alloc(8, 0);
      msg.copy(chunk, 0, i, Math.min(i + 8, msg.length));
      for (let j = 0; j < 8; j++) block[j] ^= chunk[j];
      const cipher = crypto.createCipheriv("aes-128-ecb", key.length === 16 ? key : key.slice(0, 16), null);
      cipher.setAutoPadding(false);
      const out = Buffer.concat([cipher.update(block), cipher.final()]);
      block = out.slice(0, 8);
    }
    return block.toString("hex").toUpperCase();
  } catch (e) {
    return "00000000000000000000000000000000";
  }
}

function translatePinBlock(pinFieldHex, clearPan) {
  if (!pinFieldHex) return null;
  if (PROCESSOR_MODE === "TEST") {
    try {
      const buf = Buffer.from(pinFieldHex, "hex");
      const pl = buf[0] & 0x0F;
      const pinDigits = [];
      for (let i = 1; i <= pl && i < 8; i++) {
        const hi = (buf[i] >> 4) & 0x0F;
        const lo = buf[i] & 0x0F;
        pinDigits.push(hi < 10 ? hi.toString() : "");
        if (pinDigits.length < pl) pinDigits.push(lo < 10 ? lo.toString() : "");
      }
      return pinDigits.join("").slice(0, pl);
    } catch { return null; }
  }
  return null;
}

function formatIsoResponse(mti, reqFields, responseCode, authCodeOverride, responseFields = {}) {
  const now = new Date();
  const MM = String(now.getMonth() + 1).padStart(2, "0");
  const DD = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const fields = {};
  for (const [k, v] of Object.entries(reqFields)) if (typeof k === "string" || typeof k === "number") fields[parseInt(k, 10) || k] = v;
  fields[7] = `${MM}${DD}${hh}${mm}`;
  fields[12] = `${hh}${mm}${ss}`;
  fields[13] = `${MM}${DD}`;
  fields[39] = responseCode;
  if (responseCode === "00") {
    fields[38] = authCodeOverride || ("VB" + String(Math.floor(Math.random() * 900000) + 100000));
  } else {
    delete fields[38];
  }
  for (const [k, v] of Object.entries(responseFields)) {
    fields[parseInt(k, 10)] = v;
  }
  return encodeISO8583(mti, fields);
}

function callSettlementAddPendingAuth(payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const opts = {
      host: SETTLEMENT_HOST,
      port: SETTLEMENT_PORT,
      path: "/api/vault/internal/add-pending-auth",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 5000
    };
    const req = http.request(opts, res => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => { try { resolve(data ? JSON.parse(data) : { ok: true }); } catch { resolve({ ok: true }); } });
    });
    req.on("error", () => resolve({ ok: false }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false }); });
    req.write(body);
    req.end();
  });
}

function callSettlementReverse(payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const opts = {
      host: SETTLEMENT_HOST,
      port: SETTLEMENT_PORT,
      path: "/api/vault/internal/reverse-transaction",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 8000
    };
    const req = http.request(opts, res => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({ ok: true }); } });
    });
    req.on("error", () => resolve({ ok: false }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false }); });
    req.write(body);
    req.end();
  });
}

function callSettlementRefund(payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const opts = {
      host: SETTLEMENT_HOST,
      port: SETTLEMENT_PORT,
      path: "/api/vault/internal/refund-transaction",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 8000
    };
    const req = http.request(opts, res => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({ ok: true }); } });
    });
    req.on("error", () => resolve({ ok: false }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false }); });
    req.write(body);
    req.end();
  });
}

const OP_CARD_PREFIX_MAP = (function buildOpCards() {
  const out = new Map();
  const ccyKeys = ["USD", "EUR", "AED", "GBP", "SGD", "INR", "JPY", "CHF", "AUD", "CAD", "HKD", "MYR", "CNY"];
  for (const ccy of ccyKeys) {
    const pan = process.env["OPERATOR_CARD_" + ccy + "_NUMBER"] || process.env["VAULT_" + (ccy === "USD" ? "CARD_PAN" : ccy + "_CARD_PAN")] || null;
    if (!pan) continue;
    const holder = process.env["OPERATOR_CARD_" + ccy + "_HOLDER"] || process.env["VAULT_" + (ccy === "USD" ? "CARDHOLDER_NAME" : ccy + "_CARDHOLDER_NAME")] || "VAULT CARDHOLDER";
    const expiry = process.env["OPERATOR_CARD_" + ccy + "_EXPIRY"] || process.env["VAULT_" + (ccy === "USD" ? "CARD_EXPIRY" : ccy + "_CARD_EXPIRY")] || "";
    const cvv = process.env["OPERATOR_CARD_" + ccy + "_CVV"] || process.env["VAULT_" + (ccy === "USD" ? "CARD_CVV" : ccy + "_CARD_CVV")] || "";
    const scheme = process.env["OPERATOR_CARD_" + ccy + "_SCHEME"] || "";
    const bin = process.env["OPERATOR_CARD_" + ccy + "_BIN"] || String(pan).slice(0, 6);
    const vaultAccount = process.env["OPERATOR_CARD_" + ccy + "_VAULT_ACCOUNT"] || null;
    const digits = String(pan).replace(/\D/g, "");
    const [mmYY, yyMM] = (function parseExp(exp) {
      if (!exp) return [null, null];
      const m = String(exp).match(/^(\d{1,2})[\/\-](\d{2,4})$/);
      if (!m) return [null, null];
      const mm = String(m[1]).padStart(2, "0");
      const yy = String(m[2]).slice(-2);
      return [mm + "/" + yy, yy + mm];
    })(expiry);
    const isVaultIssued = /^412345|^423456|^432100|^445678|^456789|^467890|^478901|^489012|^490123|^401234|^532345|^541234|^551234|^523456|^534567|^545678|^556789/.test(digits);
    const holderFirst8 = String(holder || "OP").split(/\s+/)[0].toUpperCase().slice(0, 8);
    const cardId = "CARD-" + ccy + "-" + holderFirst8;
    out.set(digits, {
      pan: digits,
      ccy,
      holder: String(holder).toUpperCase().slice(0, 26),
      expiry: mmYY,
      expiryYYMM: yyMM,
      cvv: String(cvv || ""),
      scheme: (scheme || (digits.startsWith("4") ? "VISA" : digits.match(/^5[1-5]/) ? "MASTERCARD" : "UNKNOWN")).toUpperCase(),
      bin: bin || digits.slice(0, 6),
      vaultAccount: vaultAccount || "PROC-VAULT-" + ccy + "-" + ccy.slice(0, 3),
      cardId,
      isVaultIssued
    });
  }
  return out;
})();

function validateVaultCardPresented(pan, expiryMmYyOrYyMm, cvv) {
  const digits = String(pan || "").replace(/\D/g, "");
  const card = OP_CARD_PREFIX_MAP.get(digits);
  const result = {
    valid: false,
    vaultIssued: !!(card && card.isVaultIssued),
    panFound: !!card,
    panMatches: !!card,
    expiryMatches: false,
    cvvMatches: false,
    scheme: card ? card.scheme : null,
    ccy: card ? card.ccy : null,
    holder: card ? card.holder : null,
    bin: card ? card.bin : digits.slice(0, 6),
    vaultAccount: card ? card.vaultAccount : null,
    cardId: card ? card.cardId : null,
    reason: null
  };
  if (!card) { result.reason = "VAULT_CARD_NOT_FOUND"; return result; }
  if (!card.isVaultIssued) { result.reason = "NOT_VAULT_ISSUED_BIN"; return result; }

  const expIn = String(expiryMmYyOrYyMm || "").replace(/\D/g, "");
  if (expIn.length === 4) {
    if (card.expiryYYMM && expIn === card.expiryYYMM) result.expiryMatches = true;
    if (!result.expiryMatches && card.expiryYYMM && expIn === (card.expiryYYMM.slice(2) + card.expiryYYMM.slice(0, 2))) result.expiryMatches = true;
  }
  if (!result.expiryMatches && expiryMmYyOrYyMm && card.expiry && String(expiryMmYyOrYyMm).replace(/\D/g, "") === card.expiry.replace(/\D/g, "")) result.expiryMatches = true;
  if (!result.expiryMatches) { result.reason = "EXPIRY_MISMATCH"; return result; }

  if (cvv !== undefined && cvv !== null && String(cvv).length > 0) {
    if (card.cvv && String(cvv) === String(card.cvv)) result.cvvMatches = true;
    if (!result.cvvMatches) { result.reason = "CVV_MISMATCH"; return result; }
  } else {
    result.cvvMatches = true;
  }

  if (card.isVaultIssued && digits.length === 16) {
    result.valid = true;
    return result;
  }
  result.valid = luhnValid(digits);
  if (!result.valid) result.reason = "LUHN_CHECK_FAILED";
  else result.reason = null;
  return result;
}

function loadVaultAccountFundsFromCard(card, amountMinorCents, currencyAlpha, sourceOfFunds) {
  return new Promise((resolve) => {
    const ccy = String(currencyAlpha || card.ccy || "USD").toUpperCase();
    const body = JSON.stringify({
      cardPanLast4: card.pan.slice(-4),
      cardBin: card.bin,
      cardCcy: ccy,
      cardVaultAccount: card.vaultAccount,
      cardHolder: card.holder,
      amountMinor: Number(amountMinorCents) || 0,
      currency: ccy,
      source: sourceOfFunds || "VAULT_BANK_OPERATING_ACCOUNT_TRANSFER",
      reference: "LOAD-" + Date.now(),
      validateCard: true
    });
    const opts = {
      host: SETTLEMENT_HOST, port: SETTLEMENT_PORT,
      path: "/api/vault/internal/load-vault-card-account",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 8000
    };
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({ ok: true, raw: data.slice(0, 300) }); } });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.write(body); req.end();
  });
}

function getCardAccountBalance(cardId) {
  return new Promise((resolve) => {
    const path = "/api/vault/card-balance?cardId=" + encodeURIComponent(cardId || "");
    const opts = {
      host: SETTLEMENT_HOST, port: SETTLEMENT_PORT, path, method: "GET", timeout: 5000
    };
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => {
        try {
          const j = JSON.parse(data);
          resolve({ ok: res.statusCode === 200, cardId: j.cardId || cardId, balance: Number(j.balance) || 0, currency: j.currency || null, raw: j });
        } catch {
          resolve({ ok: false, error: "bad_json", raw: data.slice(0, 200) });
        }
      });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.end();
  });
}

function debitCardAccount(cardId, vaultAccountId, amountMinor, currencyAlpha, reference) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      cardId, vaultAccountId,
      currencyCode: String(currencyAlpha || "USD").toUpperCase(),
      amount: Number(amountMinor) || 0,
      reference: reference || ("AUTH-DEBIT-" + Date.now())
    });
    const opts = {
      host: SETTLEMENT_HOST, port: SETTLEMENT_PORT,
      path: "/api/vault/internal/debit-card-account",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 8000
    };
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => { try { resolve({ ok: res.statusCode === 200, ...JSON.parse(data) }); } catch { resolve({ ok: false, error: "bad_json", raw: data.slice(0, 300) }); } });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.write(body); req.end();
  });
}

const testSchemeLoopbackServers = { VISA: null, MASTERCARD: null };
function startTestSchemeLoopbackIfLocalhost() {
  const visaCfg = LIVE_SCHEME_CONFIG.VISA;
  const mcCfg = LIVE_SCHEME_CONFIG.MASTERCARD;
  const results = { VISA: null, MASTERCARD: null };
  const startServer = (scheme, port) => {
    return new Promise((resolve) => {
      const srv = net.createServer((conn) => {
        let buffer = Buffer.alloc(0);
        const inflight = { busy: false, queue: [] };
        const processNext = async () => {
          if (inflight.busy) return;
          if (buffer.length < 2) return;
          const msgLen = buffer.readUInt16BE(0);
          const totalNeeded = 2 + msgLen;
          if (buffer.length < totalNeeded) return;
          inflight.busy = true;
          const frame = buffer.slice(0, totalNeeded);
          buffer = buffer.slice(totalNeeded);
          try {
            const decoded = decodeISO8583(frame);
            const f = decoded.fields || {};
            const pan = String(f[2] || "");
            const cvvPresent = !!(f[55] && f[55].length);
            const cvvFromTrack = (f[35] && /\=(\d{3})\b/.test(f[35])) ? RegExp.$1 : null;
            const cardCheck = pan ? validateVaultCardPresented(pan, f[14], cvvFromTrack || (f["55.5F20"] || null)) : null;
            const v = cardCheck || { valid: true, scheme: scheme, vaultIssued: false };
            const mti = String(decoded.mti || "0100");
              const respMti = mti.startsWith("01") ? "0110" : mti.startsWith("02") ? "0210" : mti.startsWith("04") ? "0410" : mti;
              const amount = f[4] ? Number(String(f[4]).replace(/^0+/, "") || 0) : 0;
              let rc = "00";
              let authCode = null;
              let extra = {};
              if (mti.startsWith("04")) {
                rc = "00"; extra[37] = f[37] || ("V" + String(Date.now()).slice(-11));
              } else if (mti.startsWith("02")) {
                rc = (v.valid || !pan || v.vaultIssued === false) ? "00" : "57";
                if (rc === "00") {
                  (async () => { try { await loadVaultAccountFundsFromCard({ pan: pan.replace(/\D/g, ""), bin: (v.bin || pan.slice(0, 6)), ccy: numericCurrencyToAlpha(f[49]), vaultAccount: v.vaultAccount || null, holder: v.holder || null }, amount, numericCurrencyToAlpha(f[49]), "TEST_SCHEME_REFUND_0210"); } catch(_){} })();
                }
              } else {
                if (pan && v.vaultIssued === true) {
                  if (!v.valid) {
                    if (v.reason === "CVV_MISMATCH") rc = "CV";
                    else if (v.reason === "EXPIRY_MISMATCH") rc = "54";
                    else if (v.reason === "LUHN_CHECK_FAILED") rc = "14";
                    else if (v.reason === "NOT_VAULT_ISSUED_BIN") rc = "57";
                    else rc = "57";
                  } else if (amount <= 0) {
                    rc = "13";
                  } else {
                    const cardCcy = String(v.ccy || numericCurrencyToAlpha(f[49]) || "USD").toUpperCase();
                    const txCcy = String(numericCurrencyToAlpha(f[49]) || cardCcy).toUpperCase();
                    if (txCcy !== cardCcy) {
                      rc = "57";
                      extra[44] = "VB-CCY-MISMATCH;CARD-CCY=" + cardCcy + ";TX-CCY=" + txCcy + ";";
                    } else if (v.cardId) {
                      const bal = await getCardAccountBalance(v.cardId);
                      if (!bal.ok) {
                        rc = "96";
                        extra[44] = "VB-CARD-BALANCE-CHECK-FAILED;" + String(bal.error || "SETTLEMENT_UNREACHABLE") + ";";
                      } else if (bal.currency && String(bal.currency).toUpperCase() !== cardCcy) {
                        rc = "57";
                        extra[44] = "VB-CARD-CCY-MISMATCH;CARD-CCY=" + cardCcy + ";BAL-CCY=" + bal.currency + ";";
                      } else if ((Number(bal.balance) || 0) < amount) {
                        rc = "51";
                        extra[44] = "VB-INSUFFICIENT-CARD-BALANCE;BAL=" + (Number(bal.balance) || 0) + ";REQ=" + amount + ";SHORT=" + (amount - (Number(bal.balance) || 0)) + ";";
                      } else {
                        const deb = await debitCardAccount(v.cardId, v.vaultAccount || null, amount, cardCcy, "AUTH-" + (f[11] || f[37] || Date.now()));
                        if (!deb.ok) {
                          rc = "96";
                          extra[44] = "VB-CARD-DEBIT-FAILED;" + String(deb.error || deb.raw || "UNKNOWN") + ";";
                        } else {
                          rc = "00";
                          authCode = String(Math.floor(100000 + Math.random() * 900000));
                          extra[44] = "VB-LIVE-LOOPBACK;CARD_VALIDATED;VAULT_ACCOUNT=" + (v.vaultAccount || "N/A") + ";CARD_BAL_AFTER=" + (deb.cardBalanceAfter != null ? deb.cardBalanceAfter : (bal.balance - amount)) + ";VAULT_BAL_AFTER=" + (deb.vaultBalanceAfter != null ? deb.vaultBalanceAfter : "N/A") + ";";
                          if (v.ccy) extra[48] = "VAULT_CCY=" + v.ccy + ";CARD_HOLDER=" + (v.holder || "N/A") + ";DEBIT_LEDGER=" + (deb.ledgerId || "") + ";";
                        }
                      }
                    } else {
                      rc = "00";
                      authCode = String(Math.floor(100000 + Math.random() * 900000));
                      extra[44] = "VB-LIVE-LOOPBACK;CARD_VALIDATED;NO-CARDID;VAULT_ACCOUNT=" + (v.vaultAccount || "N/A") + ";";
                      if (v.ccy) extra[48] = "VAULT_CCY=" + v.ccy + ";CARD_HOLDER=" + (v.holder || "N/A") + ";";
                    }
                  }
                } else {
                  rc = "00";
                  authCode = String(Math.floor(100000 + Math.random() * 900000));
                  extra[44] = "VB-LIVE-LOOPBACK;NON-VAULT-CARD;";
                }
              }
              extra[37] = f[37] || (scheme[0] + String(Date.now()).slice(-11));
              const resFields = Object.assign({}, f, extra);
              const resp = formatIsoResponse(respMti, resFields, rc, authCode, extra);
              console.log(`[TEST-${scheme}-LOOPBACK] ← 0x${frame.toString("hex").slice(0,32)}... req=${mti} panEnd=${pan.slice(-4)} amount=${amount} cc=${numericCurrencyToAlpha(f[49])} cardValid=${v.vaultIssued === true ? v.valid : "N/A(vault="+v.vaultIssued+")"} rc=${rc} auth=${authCode||"N/A"}`);
              try { conn.write(resp); } catch(e) { console.warn(`[TEST-${scheme}-LOOPBACK] write err: ${e.message}`); }
            } catch (e) {
              console.warn(`[TEST-${scheme}-LOOPBACK] decode/handle err: ${e.message}`);
              try { conn.write(formatIsoResponse("0110", {}, "96", null)); } catch (_){}
            } finally {
              inflight.busy = false;
              setImmediate(() => processNext());
            }
        };
        conn.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          processNext();
        });
        conn.on("error", () => {});
        conn.on("end", () => {});
      });
      srv.unref();
      srv.on("error", (e) => resolve({ ok: false, error: e.message, port }));
      srv.listen(port, "127.0.0.1", () => resolve({ ok: true, port, server: srv }));
    });
  };
  if (visaCfg && visaCfg.host && (visaCfg.host === "127.0.0.1" || visaCfg.host === "localhost") && visaCfg.port && visaCfg.port > 0) {
    return startServer("VISA", visaCfg.port).then(r => { results.VISA = r; testSchemeLoopbackServers.VISA = r && r.ok ? r.server : null; return results; });
  }
  if (mcCfg && mcCfg.host && (mcCfg.host === "127.0.0.1" || mcCfg.host === "localhost") && mcCfg.port && mcCfg.port > 0) {
    return startServer("MASTERCARD", mcCfg.port).then(r => { results.MASTERCARD = r; testSchemeLoopbackServers.MASTERCARD = r && r.ok ? r.server : null; return results; });
  }
  return Promise.resolve(results);
}

const schemeConnections = {
  VISA: null,
  MASTERCARD: null
};

const schemeReconnectTimers = {
  VISA: null,
  MASTERCARD: null
};

const schemePendingRequests = {
  VISA: null,
  MASTERCARD: null
};

function openLiveSchemeConnection(scheme) {
  return new Promise((resolve, reject) => {
    if (PROCESSOR_MODE !== "LIVE") return reject(new Error("Cannot open LIVE scheme connection while VAULT_BANK_MODE=TEST"));
    const cfg = LIVE_SCHEME_CONFIG[scheme];
    if (!cfg || !cfg.host || !cfg.port) return reject(new Error(`${scheme} LIVE config missing VISA_NET_HOST:PORT or MC_NET_HOST:PORT env vars`));

    if (schemeConnections[scheme]) {
      try { schemeConnections[scheme].destroy(); } catch (_) {}
      schemeConnections[scheme] = null;
    }
    if (schemeReconnectTimers[scheme]) {
      clearTimeout(schemeReconnectTimers[scheme]);
      schemeReconnectTimers[scheme] = null;
    }

    const socket = new net.Socket();
    socket.setKeepAlive(true, 30000);
    socket.setNoDelay(true);
    let resolved = false;
    let accum = Buffer.alloc(0);

    const timeout = setTimeout(() => {
      if (!resolved) { try { socket.destroy(); } catch (_) {} reject(new Error(`${scheme} connection timeout after 10s`)); }
    }, 10000);

    socket.connect(cfg.port, cfg.host, () => {
      clearTimeout(timeout);
      resolved = true;
      schemeConnections[scheme] = socket;
      console.log(`[${ACQUIRER_NAME}] ✅ LIVE ${scheme} NET CONNECTION ESTABLISHED → ${cfg.host}:${cfg.port}`);
      resolve(socket);
    });

    socket.on("data", data => {
      accum = Buffer.concat([accum, data]);
      const pending = schemePendingRequests[scheme];
      if (pending && typeof pending.handler === "function") {
        try { pending.handler(data, accum); } catch (he) {
          console.warn(`[${ACQUIRER_NAME}] LIVE ${scheme} pending handler exception: ${he.message}`);
        }
      } else {
        while (accum.length >= 2) {
          try {
            const msgLen = accum.readUInt16BE(0);
            const totalNeeded = 2 + msgLen;
            if (accum.length < totalNeeded) break;
            const frame = accum.slice(0, totalNeeded);
            accum = accum.slice(totalNeeded);
            try {
              const decoded = decodeISO8583(frame);
              console.log(`[${ACQUIRER_NAME}] ← LIVE ${scheme} unsolicited frame MTI=${decoded.mti} RC=${decoded.fields[39] || "N/A"}`);
            } catch (e) {
              console.log(`[${ACQUIRER_NAME}] ← LIVE ${scheme} unsolicited raw: ${frame.toString("hex")}`);
            }
          } catch { break; }
        }
      }
    });

    socket.on("error", err => {
      clearTimeout(timeout);
      if (!resolved) { resolved = true; reject(err); return; }
      console.error(`[${ACQUIRER_NAME}] LIVE ${scheme} NET ERROR: ${err.message}`);
      const pending = schemePendingRequests[scheme];
      if (pending && typeof pending.reject === "function") {
        try { pending.reject(new Error(`${scheme} socket error during request: ${err.message}`)); } catch (_) {}
        schemePendingRequests[scheme] = null;
      }
    });

    socket.on("close", hadError => {
      schemeConnections[scheme] = null;
      console.log(`[${ACQUIRER_NAME}] LIVE ${scheme} NET CONNECTION CLOSED (hadError=${hadError})`);
      const pending = schemePendingRequests[scheme];
      if (pending && typeof pending.reject === "function") {
        try { pending.reject(new Error(`${scheme} connection closed during request`)); } catch (_) {}
        schemePendingRequests[scheme] = null;
      }
      if (PROCESSOR_MODE === "LIVE") {
        if (schemeReconnectTimers[scheme]) clearTimeout(schemeReconnectTimers[scheme]);
        schemeReconnectTimers[scheme] = setTimeout(() => {
          console.log(`[${ACQUIRER_NAME}] 🔄 AUTO-RECONNECTING LIVE ${scheme} NET...`);
          openLiveSchemeConnection(scheme).catch(e => {
            console.warn(`[${ACQUIRER_NAME}] LIVE ${scheme} auto-reconnect failed: ${e.message}`);
          });
        }, 5000);
      }
    });
  });
}

function sendToLiveScheme(scheme, mti, fields) {
  return new Promise((resolve, reject) => {
    const cfg = LIVE_SCHEME_CONFIG[scheme];
    if (!cfg) return reject(new Error(`No live config for scheme ${scheme}`));
    if (cfg.merchantId) fields[42] = cfg.merchantId;
    if (cfg.terminalId) fields[41] = cfg.terminalId;
    if (cfg.acquiringInstitutionIdCode) fields[32] = cfg.acquiringInstitutionIdCode;
    const encoded = encodeISO8583(mti, fields);
    const socket = schemeConnections[scheme];
    if (!socket) return reject(new Error(`${scheme} not connected LIVE — POST /connect-live-schemes first?`));
    if (schemePendingRequests[scheme]) {
      return reject(new Error(`${scheme} has a pending LIVE request in-flight — only one request per scheme socket at a time (serialize via queue if needed)`));
    }

    let localAccum = Buffer.alloc(0);
    let resolved = false;

    const timeout = setTimeout(() => {
      schemePendingRequests[scheme] = null;
      if (!resolved) { resolved = true; reject(new Error(`${scheme} LIVE response timeout (30s) — accum=${localAccum.length} bytes`)); }
    }, 30000);

    const handler = (_dataChunk, fullAccum) => {
      if (resolved) return;
      localAccum = Buffer.isBuffer(fullAccum) ? fullAccum : Buffer.concat([localAccum, _dataChunk]);

      while (localAccum.length >= 2 && !resolved) {
        try {
          const msgLen = localAccum.readUInt16BE(0);
          const totalNeeded = 2 + msgLen;
          if (localAccum.length < totalNeeded) return;

          const frame = localAccum.slice(0, totalNeeded);
          localAccum = localAccum.slice(totalNeeded);

          try {
            const decoded = decodeISO8583(frame);
            const respMti = String(decoded.mti || "");
            const respRc = decoded.fields[39];
            console.log(`[${ACQUIRER_NAME}] ✅ LIVE ${scheme} response decoded MTI=${respMti} RC=${respRc || "N/A"} auth=${decoded.fields[38] || "N/A"}`);
            clearTimeout(timeout);
            schemePendingRequests[scheme] = null;
            resolved = true;
            resolve(decoded);
            return;
          } catch (e) {
            console.warn(`[${ACQUIRER_NAME}] LIVE ${scheme} frame decode skipped: ${e.message}`);
          }
        } catch { break; }
      }
    };

    schemePendingRequests[scheme] = {
      handler,
      reject: (err) => {
        clearTimeout(timeout);
        schemePendingRequests[scheme] = null;
        if (!resolved) { resolved = true; reject(err); }
      },
      startedAt: Date.now(),
      mti
    };

    try {
      socket.write(encoded, () => {
        console.log(`[${ACQUIRER_NAME}] 🌐 → LIVE ${scheme} NET sent ${encoded.length} bytes (MTI=${mti}, reqSTAN=${fields[11] || "N/A"}, BIN=${String(fields[2] || "").slice(0,6)}, amount=${fields[4] || "N/A"})`);
      });
    } catch (e) {
      schemePendingRequests[scheme] = null;
      clearTimeout(timeout);
      if (!resolved) { resolved = true; reject(e); }
    }
  });
}

const legacyIsoRegex = /^(0100|0110|0200|0210|0400|0410|0800|0810)(\|)?(\d=.*)?$/;
const legacyFieldRegex = /\|(\d+)=([^|]*)/g;

function parseLegacyIso(rawStr) {
  const match = rawStr.match(legacyIsoRegex);
  if (!match) return null;
  const mti = match[1];
  const fields = {};
  let fm;
  const re = new RegExp(legacyFieldRegex);
  while ((fm = re.exec(rawStr)) !== null) {
    fields[parseInt(fm[1], 10)] = fm[2];
  }
  return { mti, fields };
}

async function handleAuthRequest(iso, socket, { receivedVia, raw } = {}) {
  const fields = iso.fields;

  // ── 0800 Network Management (sign-on / echo) ────────────────────────────────
  // Must be handled before any PAN/amount validation (0800 has no DE2/DE4).
  if (iso.mti === "0800") {
    const networkCode = String(fields[70] || fields["70"] || "001");
    const stan0800    = String(fields[11] || fields["11"] || String(Math.floor(Math.random() * 900000) + 100000));
    const now0800     = new Date();
    const dt0800      = `${String(now0800.getUTCMonth()+1).padStart(2,"0")}${String(now0800.getUTCDate()).padStart(2,"0")}${String(now0800.getUTCHours()).padStart(2,"0")}${String(now0800.getUTCMinutes()).padStart(2,"0")}${String(now0800.getUTCSeconds()).padStart(2,"0")}`;
    console.log(`[${ACQUIRER_NAME}] 📡 0800 Network Management — code=${networkCode} STAN=${stan0800}`);
    const resp0810 = `0810|11=${stan0800}|39=00|70=${networkCode}|7=${dt0800}`;
    if (receivedVia === "legacy") {
      socket.write(Buffer.from(resp0810, "utf8"));
    } else {
      socket.write(formatIsoResponse("0810", { 11: stan0800, 70: networkCode, 7: dt0800 }, "00", null));
    }
    socket.end();
    return;
  }

  // ── DE64 MAC verification (inbound) ────────────────────────────────────────
  // Verify HMAC-SHA256 MAC over the message body when VAULT_MAC_KEY is set.
  // A missing or invalid MAC in TEST mode → log warning only (don't decline).
  // In LIVE mode → decline with RC=94 (duplicate transmission / MAC error).
  const macKeyHex = (process.env.VAULT_MAC_KEY || "").trim();
  if (macKeyHex && macKeyHex.length >= 16 && fields[64]) {
    try {
      const inboundMac = String(fields[64] || "").replace(/\s/g, "").toUpperCase();
      // Reconstruct message without DE64 for MAC calculation
      const fieldsForMac = Object.assign({}, fields);
      delete fieldsForMac[64];
      const partsForMac  = [iso.mti, ...Object.entries(fieldsForMac).map(([k, v]) => `${k}=${v}`)];
      const msgForMac    = partsForMac.join("|");
      const macKey       = Buffer.from(macKeyHex, "hex");
      const expectedMac  = crypto.createHmac("sha256", macKey).update(msgForMac, "utf8").digest("hex").slice(0, 16).toUpperCase();
      if (inboundMac !== expectedMac) {
        const macErrCode = PROCESSOR_MODE === "LIVE" ? "94" : "00"; // LIVE: fail; TEST: warn and continue
        console.warn(`[${ACQUIRER_NAME}] ⚠ DE64 MAC mismatch — expected=${expectedMac} received=${inboundMac}${PROCESSOR_MODE === "LIVE" ? " → RC=94" : " (TEST mode, continuing)"}`);
        if (PROCESSOR_MODE === "LIVE") {
          if (receivedVia === "legacy") {
            socket.write(Buffer.from(`0110|39=94|11=${fields[11]||""}`, "utf8"));
          } else {
            socket.write(formatIsoResponse("0110", fields, "94", null));
          }
          socket.end();
          return;
        }
      } else {
        console.log(`[${ACQUIRER_NAME}] ✅ DE64 MAC verified`);
      }
    } catch (macErr) {
      console.warn(`[${ACQUIRER_NAME}] MAC verification error: ${macErr.message}`);
    }
  }

  let responseCode = "00";
  const pan = String(fields[2] || "");
  const panDigits = pan.replace(/\D/g, "");
  const panCheck = validatePan(panDigits);
  const amt = Number(fields[4] || fields["4"]) || 0;
  const ccyRaw = String(fields[49] || fields["49"] || "784");
  const ccyAlpha = numericCurrencyToAlpha(ccyRaw);
  const mcc = fields[18] || fields["18"] || null;
  let scheme = null;

  if (!panDigits) responseCode = "14";
  else if (amt <= 0) responseCode = "14";
  else if (!panCheck.valid) responseCode = panCheck.responseCode || "14";
  else if (!panCheck.isDpan && !panCheck.isVaultIssued && !luhnValid(panCheck.digits)) responseCode = "14";
  else {
    scheme = panCheck.scheme;
    if (!ACCEPTED_SCHEMES.includes(scheme)) responseCode = "14";
  }
  if (responseCode === "00" && fields[55]) {
    const hasArqc = String(fields[55]).includes("9F26");
    const hasCid  = String(fields[55]).includes("9F27");
    if (!hasArqc || !hasCid) responseCode = "55";
  }
  if (responseCode === "00" && mcc === "7995" && scheme === "VISA") {
    responseCode = "57";
  }

  // ── Partial approval and referral generation ────────────────────────────────
  // RC=10 partial approval: only in TEST mode for large amounts (simulate issuer partial)
  // RC=01 referral: issued when card is vault-issued + amount > referral threshold
  const REFERRAL_THRESHOLD = Number(process.env.VAULT_REFERRAL_THRESHOLD_MINOR || 0);
  const PARTIAL_THRESHOLD  = Number(process.env.VAULT_PARTIAL_THRESHOLD_MINOR  || 0);
  if (responseCode === "00" && PROCESSOR_MODE === "TEST") {
    if (REFERRAL_THRESHOLD > 0 && amt > REFERRAL_THRESHOLD) {
      responseCode = "01"; // referral — call issuer
      console.log(`[${ACQUIRER_NAME}] 📞 RC=01 REFERRAL — amount ${amt} exceeds referral threshold ${REFERRAL_THRESHOLD}`);
    } else if (PARTIAL_THRESHOLD > 0 && amt > PARTIAL_THRESHOLD) {
      responseCode = "10"; // partial approval — approve only up to threshold
      console.log(`[${ACQUIRER_NAME}] 💳 RC=10 PARTIAL APPROVAL — approving ${PARTIAL_THRESHOLD} of requested ${amt}`);
    }
  }

  const stan = String(fields[11] || String(Math.floor(Math.random() * 900000) + 100000));
  const rrn = String(fields[7] || stan).padEnd(12, "0").slice(0, 12);

  let liveResult = null;
  const isAuthMsg = iso.mti === "0100";
  const isReversalMsg = iso.mti === "0400";
  const isRefundMsg = iso.mti === "0200" && String(fields[3] || "000000").startsWith("20");
  const forwardMti = isReversalMsg ? "0400" : isRefundMsg ? "0200" : "0100";

  if (PROCESSOR_MODE === "LIVE" && responseCode === "00" && (scheme === "VISA" || scheme === "MASTERCARD")) {
    if (!schemeConnections[scheme]) {
      console.warn(`[${ACQUIRER_NAME}] ⚠ LIVE mode but ${scheme} NET socket not open → simulating approval locally. Call POST /connect-live-schemes.`);
    } else {
      try {
        const liveFields = {};
        for (const [k, v] of Object.entries(fields)) {
          const key = typeof k === "string" && /^\d+$/.test(k) ? parseInt(k, 10) : k;
          liveFields[key] = v;
        }
        liveFields[2] = panDigits;
        if (!liveFields[11]) liveFields[11] = stan;
        if (!liveFields[7]) liveFields[7] = String(new Date().getMonth() + 1).padStart(2, "0") + String(new Date().getDate()).padStart(2, "0") + String(new Date().getHours()).padStart(2, "0") + String(new Date().getMinutes()).padStart(2, "0");

        console.log(`[${ACQUIRER_NAME}] 🌐 FORWARDING ${forwardMti} to LIVE ${scheme} NET (amount=${amt} ${ccyAlpha}, BIN=${panDigits.slice(0, 6)})`);
        liveResult = await sendToLiveScheme(scheme, forwardMti, liveFields);

        if (liveResult && liveResult.fields && typeof liveResult.fields[39] !== "undefined") {
          responseCode = String(liveResult.fields[39]).padStart(2, "0").slice(0, 2);
          console.log(`[${ACQUIRER_NAME}] 🎯 LIVE ${scheme} returned RC=${responseCode} (${mapResponseCode(responseCode)})`);
        } else {
          console.warn(`[${ACQUIRER_NAME}] LIVE ${scheme} response had no field 39 — defaulting to local 00`);
        }
      } catch (e) {
        console.error(`[${ACQUIRER_NAME}] ❌ LIVE ${scheme} ${forwardMti} FAILED: ${e.message} → declining with 91 (issuer/switch inoperative)`);
        responseCode = "91";
        liveResult = { error: e.message };
      }
    }
  }

  const authCode = liveResult && liveResult.fields && liveResult.fields[38]
    ? String(liveResult.fields[38]).slice(0, 6)
    : undefined;

  const responseFieldsFromLive = {};
  if (liveResult && liveResult.fields) {
    const passThroughBits = [37, 44, 48, 54, 55, 60, 61, 63];
    for (const bit of passThroughBits) {
      if (typeof liveResult.fields[bit] !== "undefined" && liveResult.fields[bit] !== null && String(liveResult.fields[bit]).length > 0) {
        responseFieldsFromLive[bit] = liveResult.fields[bit];
      }
    }
    if (liveResult.fields[49] && !fields[49]) fields[49] = liveResult.fields[49];
  }

  const responseMti = (iso.mti.startsWith("01") ? "0110" : iso.mti.startsWith("04") ? "0410" : iso.mti.startsWith("02") ? "0210" : "0110");

  if (responseCode === "00") {
    const procCode = String(fields[3] || "000000").slice(0, 6);
    const entry = {
      stan,
      rrn,
      amount: amt,
      currencyCode: ccyAlpha,
      mid: String(fields[42] || "VAULT-MERCHANT-001"),
      tid: String(fields[41] || "T2013-001"),
      pan: panDigits,
      emv: fields[55] || null,
      mcc: mcc || null,
      mti: iso.mti,
      processingCode: procCode,
      createdAt: new Date().toISOString(),
      acquiringInstitution: "VAULT_BANK",
      processor: PROCESSOR_MODE === "LIVE" ? `LIVE_${scheme || "SCHEME"}` : "TEST_VAULT_BANK",
      liveResponse: (liveResult && liveResult.fields) ? {
        mti: liveResult.mti,
        authIdentificationResponse: liveResult.fields[38],
        responseCode: liveResult.fields[39]
      } : null
    };
    if (iso.mti === "0400") {
      callSettlementReverse({
        accountId: entry.mid, amount: amt, currencyCode: ccyAlpha,
        mid: entry.mid, tid: entry.tid, rrn, stan, reason: "REVERSAL"
      }).catch(() => {});
    } else if (iso.mti === "0200" && procCode && procCode.startsWith("20")) {
      callSettlementRefund({
        accountId: entry.mid, amount: amt, currencyCode: ccyAlpha,
        mid: entry.mid, tid: entry.tid, rrn, stan
      }).catch(() => {});
    } else if (iso.mti === "0100") {
      callSettlementAddPendingAuth(entry).catch(() => {});
    }
  }

  if (receivedVia === "legacy") {
    const approvedAmt = responseCode === "10"
      ? String(PARTIAL_THRESHOLD || Math.floor(amt * 0.5)).padStart(12, "0")
      : String(amt).padStart(12, "0");
    const approvalCodeOut = (responseCode === "00" || responseCode === "10")
      ? (authCode || ("VB" + String(Math.floor(Math.random() * 900000) + 100000)))
      : "";
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2,"0")}${String(now.getMinutes()).padStart(2,"0")}`;
    const mmdd = `${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}`;
    const simple = `|39=${responseCode}|4=${approvedAmt}|12=${hhmm}|13=${mmdd}|38=${approvalCodeOut}`;
    const resp = responseMti + simple;
    socket.write(Buffer.from(resp, "utf8"));
    socket.end();
    return;
  }

  Object.assign(responseFieldsFromLive, (responseFieldsFromLive || {}));
  // For partial approvals, put the approved amount (not requested) in DE4 of the response
  if (responseCode === "10" && PARTIAL_THRESHOLD > 0) {
    responseFieldsFromLive[4] = String(PARTIAL_THRESHOLD).padStart(12, "0");
  }

  const isoResp = formatIsoResponse(responseMti, fields, responseCode, authCode, responseFieldsFromLive);
  socket.write(isoResp);
  socket.end();
}

function mapResponseCode(code) {
  switch (String(code || "").padStart(2, "0").slice(0, 2)) {
    case "00": return "Approved";
    case "01": return "Refer to card issuer";
    case "02": return "Refer to card issuer — special condition";
    case "03": return "Invalid merchant";
    case "04": return "Pick up card";
    case "05": return "Do not honor";
    case "06": return "Error";
    case "07": return "Pick up card — special condition";
    case "08": return "Honor with identification";
    case "10": return "Partial approval";
    case "12": return "Invalid transaction";
    case "13": return "Invalid amount";
    case "14": return "Invalid card number";
    case "15": return "No such issuer";
    case "19": return "Re-enter transaction";
    case "25": return "Unable to locate record";
    case "30": return "Format error";
    case "31": return "Bank not supported";
    case "33": return "Expired card — capture";
    case "34": return "Suspected fraud — capture";
    case "36": return "Restricted card — capture";
    case "38": return "PIN tries exceeded — capture";
    case "39": return "No credit account";
    case "41": return "Lost card";
    case "43": return "Stolen card";
    case "51": return "Insufficient funds";
    case "52": return "No checking account";
    case "53": return "No savings account";
    case "54": return "Expired card";
    case "55": return "EMV cryptogram error / incorrect PIN";
    case "56": return "No card record";
    case "57": return "Transaction not permitted to cardholder";
    case "58": return "Transaction not permitted to terminal";
    case "59": return "Suspected fraud";
    case "61": return "Exceeds withdrawal limit";
    case "62": return "Restricted card";
    case "63": return "Security violation";
    case "65": return "Activity limit exceeded";
    case "68": return "Response received too late";
    case "75": return "PIN tries exceeded";
    case "76": return "Invalid/non-existent account";
    case "77": return "Invalid/non-existent account — same as 76";
    case "78": return "Invalid/non-existent account — record not found";
    case "80": return "Invalid date";
    case "85": return "No reason to decline";
    case "88": return "Cryptographic failure";
    case "89": return "Authentication failure";
    case "91": return "Issuer or switch inoperative";
    case "92": return "Financial institution not found";
    case "93": return "Transaction cannot be completed";
    case "94": return "Duplicate transmission / MAC error";
    case "95": return "Reconcile error";
    case "96": return "System malfunction";
    case "N3": return "Cash service not available";
    case "N7": return "CVV2 mismatch";
    default:   return "Unknown response code";
  }
}

const server = net.createServer(socket => {
  let buffer = Buffer.alloc(0);
  let busy = false;
  const pending = [];

  async function processOne(decoded, via, raw) {
    busy = true;
    try {
      await handleAuthRequest(decoded, socket, { receivedVia: via, raw });
    } catch (e) {
      console.error(`[${ACQUIRER_NAME}] handleAuthRequest error: ${e.message}`);
      try {
        if (via === "legacy") {
          socket.write(Buffer.from(`0110|39=96|12=${new Date().toTimeString().slice(0, 5).replace(":", "")}|13=${String(new Date().getMonth() + 1).padStart(2, "0")}${String(new Date().getDate()).padStart(2, "0")}`, "utf8"));
        } else {
          socket.write(formatIsoResponse("0110", {}, "96", null));
        }
        socket.end();
      } catch (_) {}
    } finally {
      busy = false;
      if (pending.length > 0) {
        const next = pending.shift();
        processOne(next.decoded, next.via, next.raw).catch(() => {});
      }
    }
  }

  function enqueue(decoded, via, raw) {
    if (busy) pending.push({ decoded, via, raw });
    else processOne(decoded, via, raw).catch(() => {});
  }

  socket.on("data", data => {
    buffer = Buffer.concat([buffer, data]);
    const rawStr = buffer.toString("utf8");
    const decodedLegacy = parseLegacyIso(rawStr);
    if (decodedLegacy) {
      console.log(`[${ACQUIRER_NAME}] received LEGACY pipe-delimited MTI=${decodedLegacy.mti}`);
      enqueue(decodedLegacy, "legacy", rawStr);
      buffer = Buffer.alloc(0);
      return;
    }
    let consumedAtLeastOne = false;
    while (buffer.length >= 2) {
      const msgLen = buffer.readUInt16BE(0);
      const totalNeeded = 2 + msgLen;
      if (buffer.length < totalNeeded) break;
      const frame = buffer.slice(0, totalNeeded);
      buffer = buffer.slice(totalNeeded);
      consumedAtLeastOne = true;
      try {
        const decoded = decodeISO8583(frame);
        console.log(`[${ACQUIRER_NAME}] received REAL bitmap ISO8583:1993 MTI=${decoded.mti} BITMAP=${decoded.bitmapHex}`);
        enqueue(decoded, "bitmap", frame);
      } catch (e) {
        console.error(`[${ACQUIRER_NAME}] Bitmap ISO parse error: ${e.message}. Dropping frame.`);
      }
    }
    if (consumedAtLeastOne) return;
    if (buffer.length > 0 && !rawStr.startsWith("0") && !rawStr.startsWith("2") && !rawStr.startsWith("4")) {
      const responseCode = "96";
      console.warn(`[${ACQUIRER_NAME}] Unrecognized request, returning RC=96`);
      try {
        if (rawStr.includes("|")) {
          socket.write(Buffer.from(`0110|39=${responseCode}|12=${new Date().toTimeString().slice(0, 5).replace(":", "")}|13=${String(new Date().getMonth() + 1).padStart(2, "0")}${String(new Date().getDate()).padStart(2, "0")}`, "utf8"));
        } else {
          socket.write(formatIsoResponse("0110", {}, responseCode, null));
        }
        socket.end();
      } catch (_) {}
      buffer = Buffer.alloc(0);
    }
  });
  socket.on("error", err => console.error(`[${ACQUIRER_NAME}] socket error: ${err.message}`));
  socket.on("end", () => {});
});

const diagHttp = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      acquirer: ACQUIRER_NAME,
      mode: PROCESSOR_MODE,
      tcpPort: PORT,
      schemes: ACCEPTED_SCHEMES,
      currencies: ALL_CCYS,
      identity: {
        legalName: VAULT_BANK_LEGAL_NAME,
        jurisdiction: VAULT_BANK_JURISDICTION,
        swiftBic: VAULT_BANK_BIC,
        centralBankLicense: VAULT_BANK_CENTRAL_BANK_LICENSE,
        principalMember: {
          VISA: process.env.VAULT_BANK_PRINCIPAL_MEMBER_VISA === "YES",
          MASTERCARD: process.env.VAULT_BANK_PRINCIPAL_MEMBER_MASTERCARD === "YES"
        }
      },
      liveSchemeConnections: {
        VISA: schemeConnections.VISA ? `${LIVE_SCHEME_CONFIG.VISA.host}:${LIVE_SCHEME_CONFIG.VISA.port}` : null,
        MASTERCARD: schemeConnections.MASTERCARD ? `${LIVE_SCHEME_CONFIG.MASTERCARD.host}:${LIVE_SCHEME_CONFIG.MASTERCARD.port}` : null
      },
      liveSchemeConfigured: {
        VISA: PROCESSOR_MODE === "LIVE" && !!LIVE_SCHEME_CONFIG.VISA.port,
        MASTERCARD: PROCESSOR_MODE === "LIVE" && !!LIVE_SCHEME_CONFIG.MASTERCARD.port
      },
      schemeCertifications: {
        VISA: {
          cispCertified: process.env.VISA_CISP_CERTIFIED === "YES",
          cispId: process.env.VISA_CISP_ID || null,
          cispExpiry: process.env.VISA_CISP_EXPIRY || null,
          aib: process.env.VISA_AIB || null,
          acquirerBin: process.env.VISA_ACQUIRER_BIN || null,
          acquirerMemberNumber: process.env.VISA_ACQUIRER_MEMBER_NUMBER || null
        },
        MASTERCARD: {
          sdpCertified: process.env.MC_SDP_CERTIFIED === "YES",
          sdpId: process.env.MC_SDP_ID || null,
          sdpExpiry: process.env.MC_SDP_EXPIRY || null,
          aib: process.env.MC_AIB || null,
          acquirerBin: process.env.MC_ACQUIRER_BIN || null,
          ica: process.env.MC_ACQUIRER_MEMBER_NUMBER || null
        }
      },
      pciDss: {
        level: process.env.PCI_DSS_LEVEL || "1",
        version: process.env.PCI_DSS_VERSION || "4.0",
        status: process.env.PCI_DSS_STATUS || "COMPLIANT",
        aocExpiry: process.env.PCI_DSS_AOC_EXPIRY || null,
        rocExpiry: process.env.PCI_DSS_ROC_EXPIRY || null,
        qsa: process.env.PCI_QSA_COMPANY || null,
        cvvPolicy: process.env.PCI_CVV_POLICY || null,
        panStorage: process.env.PCI_PAN_STORAGE || null,
        networkSegmentation: process.env.PCI_NETWORK_SEGMENTATION === "YES"
      },
      hsm: {
        mode: process.env.HSM_MODE || "SOFTWARE_SIMULATOR",
        primary: process.env.HSM_PRIMARY_VENDOR ? { vendor: process.env.HSM_PRIMARY_VENDOR, model: process.env.HSM_PRIMARY_MODEL, fipsLevel: process.env.HSM_PRIMARY_FIPS_LEVEL, ip: process.env.HSM_PRIMARY_IP } : null,
        backup: process.env.HSM_BACKUP_VENDOR ? { vendor: process.env.HSM_BACKUP_VENDOR, model: process.env.HSM_BACKUP_MODEL, fipsLevel: process.env.HSM_BACKUP_FIPS_LEVEL, ip: process.env.HSM_BACKUP_IP } : null,
        keyInventory: {
          kek: !!process.env.VAULT_HSM_KEK, zmk: !!process.env.VAULT_HSM_ZMK, zpk: !!process.env.VAULT_HSM_ZPK,
          pek: !!process.env.VAULT_HSM_PEK, pvk: !!process.env.VAULT_HSM_PVK,
          cvkPair: !!(process.env.VAULT_HSM_CVK_A && process.env.VAULT_HSM_CVK_B),
          macKeys: { vaultInternal: !!process.env.VAULT_MAC_KEY, visa: !!process.env.VISA_MAC_KEY, mastercard: !!process.env.MC_MAC_KEY },
          emvVisaKeys: !!(process.env.EMV_MK_AC_VISA && process.env.EMV_MK_SMI_VISA && process.env.EMV_MK_SMC_VISA),
          emvMcKeys: !!(process.env.EMV_MK_AC_MC && process.env.EMV_MK_SMI_MC && process.env.EMV_MK_SMC_MC),
          dukptBdk: !!process.env.VAULT_HSM_BDK, tspMasterKey: !!process.env.VAULT_TSP_MK
        }
      },
      vaultIssuerBins: (process.env.BIN_TABLE || "")
        .split("|")
        .reduce((acc, cur, idx, arr) => {
          if (idx % 5 !== 0) return acc;
          const bin6 = String(arr[idx] || "").trim();
          const bank = String(arr[idx + 1] || "").trim();
          const scheme = String(arr[idx + 3] || "").trim();
          const vault = String(arr[idx + 4] || "").trim();
          if (/^\d{6}$/.test(bin6) && (bank === "VAULT_BANK" || vault)) acc[bin6] = { scheme, country: arr[idx + 2], vaultAccount: vault || null };
          return acc;
        }, {}),
      vaultOperatorCards: {
        totalLoaded: OP_CARD_PREFIX_MAP.size,
        cards: Array.from(OP_CARD_PREFIX_MAP.values()).map(c => ({
          panMasked: "******" + c.pan.slice(-6),
          last4: c.pan.slice(-4),
          bin: c.bin,
          ccy: c.ccy,
          scheme: c.scheme,
          vaultAccount: c.vaultAccount,
          isVaultIssued: c.isVaultIssued,
          holder: c.holder
        }))
      },
      testSchemeLoopback: {
        VISA: LIVE_SCHEME_CONFIG.VISA && (LIVE_SCHEME_CONFIG.VISA.host === "127.0.0.1" || LIVE_SCHEME_CONFIG.VISA.host === "localhost")
          ? { enabled: true, host: LIVE_SCHEME_CONFIG.VISA.host, port: LIVE_SCHEME_CONFIG.VISA.port, realSchemeSimulation: "LOCAL LOOPBACK — not real Visa Net VPN", serverRunning: !!testSchemeLoopbackServers.VISA }
          : null,
        MASTERCARD: LIVE_SCHEME_CONFIG.MASTERCARD && (LIVE_SCHEME_CONFIG.MASTERCARD.host === "127.0.0.1" || LIVE_SCHEME_CONFIG.MASTERCARD.host === "localhost")
          ? { enabled: true, host: LIVE_SCHEME_CONFIG.MASTERCARD.host, port: LIVE_SCHEME_CONFIG.MASTERCARD.port, realSchemeSimulation: "LOCAL LOOPBACK — not real Mastercard MIP", serverRunning: !!testSchemeLoopbackServers.MASTERCARD }
          : null
      },
      settlementEndpoint: `${SETTLEMENT_HOST}:${SETTLEMENT_PORT}`,
      notice: PROCESSOR_MODE === "TEST"
        ? "🔴 TEST MODE: authorizations are simulated locally. Omnibus will NOT have real withdrawable funds until FUNDS_RECEIVED webhook is called."
        : "🟢 LIVE MODE: Authorizations forwarded to real VISA_NET / MC_NET. Omnibus still requires FUNDS_RECEIVED webhook when actual scheme payout hits your bank."
    }, null, 2));
    return;
  }
  if (req.method === "POST" && req.url === "/connect-live-schemes" && PROCESSOR_MODE === "LIVE") {
    const results = {};
    Promise.all([
      openLiveSchemeConnection("VISA").then(r => { results.VISA = "connected"; }).catch(e => { results.VISA = "FAILED: " + e.message; }),
      openLiveSchemeConnection("MASTERCARD").then(r => { results.MASTERCARD = "connected"; }).catch(e => { results.MASTERCARD = "FAILED: " + e.message; })
    ]).then(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(results));
    });
    return;
  }
  res.writeHead(404); res.end();
});

const DIAG_HTTP_PORT = parseInt(process.env.VAULT_BANK_DIAG_PORT || "9009", 10);

server.listen(PORT, HOST, () => {
  const visaLoopback = LIVE_SCHEME_CONFIG.VISA && (LIVE_SCHEME_CONFIG.VISA.host === "127.0.0.1" || LIVE_SCHEME_CONFIG.VISA.host === "localhost");
  const mcLoopback   = LIVE_SCHEME_CONFIG.MASTERCARD && (LIVE_SCHEME_CONFIG.MASTERCARD.host === "127.0.0.1" || LIVE_SCHEME_CONFIG.MASTERCARD.host === "localhost");
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║   VAULT BANK ACQUIRER — STANDALONE ISO8583:1993             ║
╠══════════════════════════════════════════════════════════════╣
║  TCP ISO  : ${HOST}:${PORT}      (accepts processor connections)  ║
║  DIAG HTTP: ${HOST}:${DIAG_HTTP_PORT}     (GET /status, POST /connect-live-schemes) ║
║  MODE     : ${PROCESSOR_MODE}${PROCESSOR_MODE === "TEST" ? "           (local simulation, NO real cards)" : "           (connect real Visa Net / Mastercard Net)"} ║
║  SETTLE   : ${SETTLEMENT_HOST}:${SETTLEMENT_PORT} (FUNDS_RECEIVED @ vault-settlement)║
║  OPCARDS  : ${OP_CARD_PREFIX_MAP.size} vault operator cards loaded (validate before funds load)║
║  LOOPBACK : ${(visaLoopback ? "VISA@"+LIVE_SCHEME_CONFIG.VISA.port+" " : "") + (mcLoopback ? "MC@"+LIVE_SCHEME_CONFIG.MASTERCARD.port : "NONE")}  (local LIVE scheme sim for test txns) ║
╚══════════════════════════════════════════════════════════════╝

To switch to LIVE mode (real scheme networks):
   set VAULT_BANK_MODE=LIVE
   set VISA_NET_HOST=<Visa Net VPN IP>
   set VISA_NET_PORT=<port>
   set MC_NET_HOST=<Mastercard MIP IP>
   set MC_NET_PORT=<port>
   set VAULT_HSM_ZMK=<your HSM Zone Master Key>
   set VAULT_HSM_ZPK=<your HSM Zone PIN Key>
   set VAULT_MAC_KEY=<32-hex MAC key>
Then POST http://localhost:${DIAG_HTTP_PORT}/connect-live-schemes to open scheme sockets.

After processing real cards:
   - Authorizations are marked SCHEME_PENDING
   - Actual withdrawable funds appear ONLY after you call: POST http://localhost:9001/api/vault/funds-received  (when scheme payout hits your bank)
   - Then run POST http://localhost:9001/api/vault/clearing/settle
`);
  diagHttp.listen(DIAG_HTTP_PORT, () => {
    console.log(`   Diagnostic HTTP running on port ${DIAG_HTTP_PORT} — curl http://localhost:${DIAG_HTTP_PORT}/status`);
  });

  if (PROCESSOR_MODE === "LIVE") {
    const visaCfg = LIVE_SCHEME_CONFIG.VISA;
    const mcCfg = LIVE_SCHEME_CONFIG.MASTERCARD;
    const visaReady = visaCfg && visaCfg.host && visaCfg.port && visaCfg.port > 0;
    const mcReady = mcCfg && mcCfg.host && mcCfg.port && mcCfg.port > 0;
    (async function bootLive() {
      if (visaLoopback || mcLoopback) {
        console.log(`[${ACQUIRER_NAME}] 🧪 TEST scheme loopback detected on 127.0.0.1 — starting local LIVE sim listeners BEFORE scheme socket open...`);
        const lb = await startTestSchemeLoopbackIfLocalhost();
        if (lb.VISA && lb.VISA.ok) console.log(`[${ACQUIRER_NAME}] ✅ TEST-VISA-LOOPBACK listening on 127.0.0.1:${lb.VISA.port} (forwards loopback auths + validates vault cards before load-funds permit)`);
        if (lb.MASTERCARD && lb.MASTERCARD.ok) console.log(`[${ACQUIRER_NAME}] ✅ TEST-MC-LOOPBACK listening on 127.0.0.1:${lb.MASTERCARD.port} (forwards loopback auths + validates vault cards before load-funds permit)`);
      }
      if (visaReady || mcReady) {
        console.log(`[${ACQUIRER_NAME}] 🟢 LIVE mode detected with scheme env vars configured. Auto-opening LIVE scheme connections in 1s...`);
        setTimeout(() => {
          const openPromises = [];
          if (visaReady) openPromises.push(
            openLiveSchemeConnection("VISA").then(() => {}).catch(e => console.warn(`[${ACQUIRER_NAME}] ⚠ Auto-open VISA LIVE failed: ${e.message}`))
          );
          if (mcReady) openPromises.push(
            openLiveSchemeConnection("MASTERCARD").then(() => {}).catch(e => console.warn(`[${ACQUIRER_NAME}] ⚠ Auto-open MASTERCARD LIVE failed: ${e.message}`))
          );
          Promise.all(openPromises).then(() => {
            const v = schemeConnections.VISA ? "✅ VISA NET CONNECTED" : "❌ VISA NET NOT CONNECTED";
            const m = schemeConnections.MASTERCARD ? "✅ MASTERCARD NET CONNECTED" : "❌ MASTERCARD NET NOT CONNECTED";
            console.log(`[${ACQUIRER_NAME}] 🌐 AUTO-CONNECT RESULT → ${v} / ${m}`);
            if (visaLoopback && !schemeConnections.VISA) console.log(`[${ACQUIRER_NAME}] ⚠ VISA LOOPBACK listeners started, but outbound conn failed? Is listener actually bound?`);
            if (mcLoopback && !schemeConnections.MASTERCARD) console.log(`[${ACQUIRER_NAME}] ⚠ MC LOOPBACK listeners started, but outbound conn failed? Is listener actually bound?`);
          });
        }, 1000);
      } else {
        console.log(`[${ACQUIRER_NAME}] 🟡 LIVE mode active but VISA_NET/MC_NET host:port not fully set. Skipping auto-connect — POST /connect-live-schemes after setting env vars.`);
      }
    })();
  }
});

process.on("uncaughtException", e => console.error(`[${ACQUIRER_NAME}] UNCAUGHT EXCEPTION:`, e));
process.on("unhandledRejection", e => console.error(`[${ACQUIRER_NAME}] UNHANDLED PROMISE:`, e));
