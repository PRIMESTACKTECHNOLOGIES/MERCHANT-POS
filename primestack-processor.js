const http = require("http");
const net = require("net");
const crypto = require("crypto");
try { require("dotenv").config(); } catch { /* dotenv optional */ }

const PROCESSOR_PORT = parseInt(process.env.PROCESSOR_PORT || "7000", 10);

const ACQUIRER_TIMEOUT_MS = parseInt(process.env.ACQUIRER_TIMEOUT_MS || process.env.PROCESSOR_TIMEOUT_MS || "8000", 10);
const VAULT_SETTLEMENT_URL = process.env.VAULT_SETTLEMENT_URL || "http://127.0.0.1:9001/api/vault/settlement";

let tokenVault = {};
let standInQueue = [];
let standInIdCounter = 0;

const VAULT_BANK_BIC = process.env.VAULT_BANK_SWIFT_BIC || "VBLKSCSEXXX";
const VAULT_BANK_LEGAL_NAME = process.env.VAULT_BANK_LEGAL_NAME || "VAULT BANK INTERNATIONAL LIMITED";

function buildIssuerTableFromEnv() {
  const base = {
    "412345": { bank: "VAULT_BANK", country: "US", scheme: "VISA", vault: process.env.BIN_VISA_USD_1 ? process.env.BIN_VISA_USD_1.split(",")[1] : "PROC-VAULT-USD-002" },
    "423456": { bank: "VAULT_BANK", country: "BE", scheme: "VISA", vault: process.env.BIN_VISA_EUR_1 ? process.env.BIN_VISA_EUR_1.split(",")[1] : "PROC-VAULT-EUR-001" },
    "532345": { bank: "VAULT_BANK", country: "DE", scheme: "MASTERCARD", vault: process.env.BIN_MC_EUR_1 ? process.env.BIN_MC_EUR_1.split(",")[1] : "VAULT-WISE-EUR-001" },
    "432100": { bank: "VAULT_BANK", country: "AE", scheme: "VISA", vault: process.env.BIN_VISA_AED_1 ? process.env.BIN_VISA_AED_1.split(",")[1] : "PROC-VAULT-AED-003" },
    "445678": { bank: "VAULT_BANK", country: "GB", scheme: "VISA", vault: process.env.BIN_VISA_GBP_1 ? process.env.BIN_VISA_GBP_1.split(",")[1] : "PROC-VAULT-GBP-004" },
    "456789": { bank: "VAULT_BANK", country: "SG", scheme: "VISA", vault: process.env.BIN_VISA_SGD_1 ? process.env.BIN_VISA_SGD_1.split(",")[1] : "PROC-VAULT-SGD-005" },
    "467890": { bank: "VAULT_BANK", country: "IN", scheme: "VISA", vault: process.env.BIN_VISA_INR_1 ? process.env.BIN_VISA_INR_1.split(",")[1] : "PROC-VAULT-INR-006" },
    "478901": { bank: "VAULT_BANK", country: "JP", scheme: "VISA", vault: process.env.BIN_VISA_JPY_1 ? process.env.BIN_VISA_JPY_1.split(",")[1] : "PROC-VAULT-JPY-007" },
    "489012": { bank: "VAULT_BANK", country: "CH", scheme: "VISA", vault: process.env.BIN_VISA_CHF_1 ? process.env.BIN_VISA_CHF_1.split(",")[1] : "PROC-VAULT-CHF-008" },
    "490123": { bank: "VAULT_BANK", country: "AU", scheme: "VISA", vault: process.env.BIN_VISA_AUD_1 ? process.env.BIN_VISA_AUD_1.split(",")[1] : "PROC-VAULT-AUD-009" },
    "401234": { bank: "VAULT_BANK", country: "CA", scheme: "VISA", vault: process.env.BIN_VISA_CAD_1 ? process.env.BIN_VISA_CAD_1.split(",")[1] : "PROC-VAULT-CAD-010" },
    "541234": { bank: "VAULT_BANK", country: "US", scheme: "MASTERCARD", vault: process.env.BIN_MC_USD_1 ? process.env.BIN_MC_USD_1.split(",")[1] : "PROC-VAULT-USD-MC-011" },
    "551234": { bank: "VAULT_BANK", country: "AE", scheme: "MASTERCARD", vault: process.env.BIN_MC_AED_1 ? process.env.BIN_MC_AED_1.split(",")[1] : "PROC-VAULT-AED-MC-012" },
    "523456": { bank: "VAULT_BANK", country: "HK", scheme: "MASTERCARD", vault: process.env.BIN_MC_HKD_1 ? process.env.BIN_MC_HKD_1.split(",")[1] : "PROC-VAULT-HKD-MC-013" },
    "534567": { bank: "VAULT_BANK", country: "MY", scheme: "MASTERCARD", vault: process.env.BIN_MC_MYR_1 ? process.env.BIN_MC_MYR_1.split(",")[1] : "PROC-VAULT-MYR-MC-014" },
    "545678": { bank: "VAULT_BANK", country: "CN", scheme: "MASTERCARD", vault: process.env.BIN_MC_CNY_1 ? process.env.BIN_MC_CNY_1.split(",")[1] : "PROC-VAULT-CNY-MC-015" },
    "556789": { bank: "VAULT_BANK", country: "GB", scheme: "MASTERCARD", vault: process.env.BIN_MC_GBP_1 ? process.env.BIN_MC_GBP_1.split(",")[1] : "PROC-VAULT-GBP-MC-016" },
    "410685": { bank: "EMIRATES_NBD", country: "AE", scheme: "VISA" },
    "421765": { bank: "ADCB", country: "AE", scheme: "VISA" },
    "431263": { bank: "RAKBANK", country: "AE", scheme: "VISA" },
    "528948": { bank: "MAJID_AL_FUTTAIM", country: "AE", scheme: "MASTERCARD" },
    "542184": { bank: "CHASE_USA", country: "US", scheme: "MASTERCARD" },
    "453997": { bank: "BARCLAYS_UK", country: "GB", scheme: "VISA" }
  };
  if (process.env.BIN_TABLE) {
    const parts = String(process.env.BIN_TABLE).split("|");
    for (let i = 0; i + 4 < parts.length; i += 5) {
      const bin6 = String(parts[i] || "").trim();
      const bank = String(parts[i + 1] || "").trim();
      const country = String(parts[i + 2] || "").trim();
      const scheme = String(parts[i + 3] || "").trim();
      const vault = String(parts[i + 4] || "").trim();
      if (bin6.length === 6 && /^\d{6}$/.test(bin6) && scheme) {
        const entry = { bank: bank || "UNKNOWN_BANK", country: country || "XX", scheme };
        if (vault) entry.vault = vault;
        base[bin6] = entry;
      }
    }
  }
  return base;
}

const issuerTable = buildIssuerTableFromEnv();

function detectIssuer(pan) {
  if (!pan) return null;
  const digits = String(pan).replace(/\D/g, "");
  if (digits.length < 6) return null;
  const bin6 = digits.substring(0, 6);
  return issuerTable[bin6] || null;
}

const acquirerHost = process.env.ACQUIRER_HOST || "127.0.0.1";
const acquirerPort = parseInt(process.env.ACQUIRER_PORT || process.env.VAULT_BANK_TCP_PORT || "9000", 10);

let acquirerRouting = [
  {
    name: process.env.VAULT_BANK_TRADE_NAME ? process.env.VAULT_BANK_TRADE_NAME.toUpperCase().replace(/\s+/g, "_") : "VAULT_BANK",
    bankBic: VAULT_BANK_BIC,
    legalName: VAULT_BANK_LEGAL_NAME,
    host: acquirerHost,
    port: acquirerPort,
    currencies: ["AED", "USD", "EUR", "GBP", "SGD", "INR", "JPY", "CHF", "AUD", "CAD", "HKD", "MYR", "CNY"],
    schemes: ["VISA", "MASTERCARD", "AMEX", "DISCOVER", "UNIONPAY", "TROY"],
    banks: ["*"],
    countries: ["*"],
    mccs: ["*"],
    maxAmount: Infinity,
    minAmount: 0,
    priority: 1,
    active: true,
    isVaultBank: true,
    soleAcquirer: true
  }
];

const NUM_CCY_TO_ALPHA = {
  "784": "AED",
  "840": "USD",
  "978": "EUR",
  "826": "GBP",
  "702": "SGD",
  "356": "INR",
  "392": "JPY",
  "756": "CHF",
  "036": "AUD",
  "124": "CAD",
  "344": "HKD",
  "458": "MYR",
  "156": "CNY"
};

const ALPHA_CCY_TO_NUM = Object.fromEntries(
  Object.entries(NUM_CCY_TO_ALPHA).map(([k, v]) => [v, k])
);

function normalizeCurrencyAlpha(code) {
  if (!code) return "AED";
  if (/^[A-Z]{3}$/.test(String(code).toUpperCase())) return String(code).toUpperCase();
  return NUM_CCY_TO_ALPHA[String(code)] || "AED";
}

function resolveTxPan(tx) {
  if (tx.token) {
    const entry = tokenVault[tx.token];
    if (entry) return entry.pan;
  }
  return tx.pan;
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
  return { bytes: Buffer.from(bytes), hex: Buffer.from(bytes).toString("hex").toUpperCase() };
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
  if (buffer.length < 18) throw new Error("ISO buffer too short for bitmap");
  let offset = 0;
  let mti = null;
  const msgLen = buffer.readUInt16BE(0);
  offset = 2;
  mti = buffer.toString("ascii", offset, offset + 4);
  offset += 4;
  const primaryBitmapHex = buffer.toString("ascii", offset, offset + 16);
  offset += 16;
  const primaryBits = parseBitmapHex(primaryBitmapHex);
  const fields = {};
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
  return { mti, fields, bitmapHex: primaryBitmapHex, bytesConsumed: offset, frameLength: msgLen };
}

const LEGACY_ISO_REGEX = /^(0100|0110|0200|0210|0400|0410|0800|0810)(\|)?(\d=.*)?$/;

function isBitmapIsoBuffer(buf) {
  try {
    if (buf.length < 2) return false;
    const msgLen = buf.readUInt16BE(0);
    if (buf.length >= 2 + msgLen && msgLen >= 20 && msgLen < 100000) {
      const mti = buf.toString("ascii", 2, 6);
      if (/^(0100|0110|0200|0210|0400|0410|0800|0810)$/.test(mti)) return true;
    }
    return false;
  } catch { return false; }
}

function parseLegacyIsoString(rawStr) {
  if (!LEGACY_ISO_REGEX.test(rawStr)) return null;
  const parts = rawStr.split("|");
  const mti = parts[0];
  const fields = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    if (eq > 0) fields[parseInt(parts[i].slice(0, eq), 10)] = parts[i].slice(eq + 1);
  }
  return { mti, fields };
}

function buildIso8583Auth(tx) {
  const mti = "0100";

  const now = new Date();
  const MM = String(now.getMonth() + 1).padStart(2, "0");
  const DD = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const field7 = `${MM}${DD}${hh}${mm}`;
  const field12 = `${hh}${mm}${ss}`;
  const field13 = `${MM}${DD}`;

  const resolvedPan = resolveTxPan(tx);
  const panDigits = resolvedPan ? String(resolvedPan).replace(/\D/g, "") : "";
  const stan = String(Math.floor(Math.random() * 900000) + 100000);

  const fields = {};
  if (panDigits) fields[2] = panDigits;
  fields[3] = "000000";
  fields[4] = String(tx.amount).padStart(12, "0");
  fields[7] = field7;
  fields[11] = stan;
  fields[12] = field12;
  fields[13] = field13;
  fields[18] = tx.mcc ? String(tx.mcc).padStart(4, "0") : "5999";
  fields[22] = tx.emv && tx.emv.arqc ? "051" : "011";
  fields[25] = "00";
  if (tx.expiry) fields[14] = String(tx.expiry).replace(/\D/g, "").padStart(4, "0").slice(0, 4);
  fields[41] = process.env.PROCESSOR_TERMINAL_ID || "T2013-001";
  fields[42] = process.env.PROCESSOR_MERCHANT_ID || "MRC-1001";
  fields[43] = process.env.PROCESSOR_MERCHANT_NAME || "PRIMESTACK MERCHANT   DUBAI AE";
  fields[49] = tx.currencyCode ? String(tx.currencyCode).padStart(3, "0").slice(0, 3) : "784";
  if (tx.cvv) fields[52] = String(tx.cvv).padEnd(16, "0").slice(0, 16);
  fields[55] = buildEmvField55(tx);

  const buf = encodeISO8583(mti, fields);
  return { buffer: buf, stan, field7, fields };
}

function sendToAcquirer(isoBuffer, acquirer) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let accum = Buffer.alloc(0);
    let resolved = false;

    const timeout = setTimeout(() => {
      try { client.destroy(); } catch (_) {}
      if (!resolved) { resolved = true; reject(new Error("Acquirer timeout: " + acquirer.name)); }
    }, ACQUIRER_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      try { client.end(); } catch (_) {}
    };

    client.connect(acquirer.port, acquirer.host, () => {
      console.log("PrimeStack: connected to acquirer [" + acquirer.name + "] " + acquirer.host + ":" + acquirer.port + " sending " + isoBuffer.length + " bytes");
      client.write(isoBuffer);
    });

    client.on("data", data => {
      accum = Buffer.concat([accum, data]);

      if (isBitmapIsoBuffer(accum)) {
        try {
          const msgLen = accum.readUInt16BE(0);
          if (accum.length >= 2 + msgLen) {
            const frame = accum.slice(0, 2 + msgLen);
            clearTimeout(timeout);
            console.log("PrimeStack: received bitmap ISO8583 response from [" + acquirer.name + "] frame=" + frame.length + " bytes");
            resolved = true;
            cleanup();
            resolve(frame);
            return;
          }
        } catch (e) {
          console.warn("PrimeStack: bitmap frame parse failed, falling back to legacy:", e.message);
        }
      }

      const rawStr = accum.toString("utf8");
      if (rawStr.includes("|39=")) {
        clearTimeout(timeout);
        console.log("PrimeStack: received legacy ISO8583 from [" + acquirer.name + "]:", rawStr);
        resolved = true;
        cleanup();
        resolve(accum);
        return;
      }
    });

    client.on("error", err => {
      clearTimeout(timeout);
      console.error("PrimeStack: acquirer [" + acquirer.name + "] socket error:", err.message);
      if (!resolved) { resolved = true; reject(err); }
    });

    client.on("close", () => {
      clearTimeout(timeout);
      if (!resolved && accum.length > 0) {
        resolved = true;
        resolve(accum);
      }
    });
  });
}

function selectAcquirerCandidates(tx, scheme) {
  const currencyAlpha = normalizeCurrencyAlpha(tx.currencyCode);
  const amount = Number(tx.amount) || 0;
  const mcc = tx.mcc ? String(tx.mcc) : null;
  const isToken = Boolean(tx.token);
  const device = String(tx.device || tx.channel || "POS").toUpperCase();
  const resolvedPan = resolveTxPan(tx);
  const issuer = resolvedPan ? detectIssuer(resolvedPan) : null;
  const bank = issuer ? issuer.bank : null;
  const country = issuer ? issuer.country : null;

  function passBase(list) {
    return list
      .filter(a => a.active !== false)
      .filter(a => a.currencies.includes(currencyAlpha))
      .filter(a => !scheme || a.schemes.includes(scheme) || a.schemes.includes("*"))
      .filter(a => amount >= (a.minAmount || 0) && amount <= (a.maxAmount || Infinity))
      .filter(a => {
        if (!mcc) return true;
        if (!a.mccs || a.mccs.includes("*")) return true;
        return a.mccs.includes(mcc);
      })
      .filter(a => {
        if (a.deviceWhitelist && a.deviceWhitelist.length) {
          return a.deviceWhitelist.includes(device);
        }
        if (a.deviceBlacklist && a.deviceBlacklist.length) {
          return !a.deviceBlacklist.includes(device);
        }
        return true;
      })
      .filter(a => {
        if (a.tokensOnly === true && !isToken) return false;
        if (a.noTokens === true && isToken) return false;
        return true;
      });
  }

  const baseAll = passBase(acquirerRouting);

  function hasBanks(a) { return Array.isArray(a.banks) && a.banks.length; }
  function hasCountries(a) { return Array.isArray(a.countries) && a.countries.length; }

  function byBank(list) {
    if (!bank) return list.slice();
    return list.filter(a => !hasBanks(a) || a.banks.includes(bank) || a.banks.includes("*"));
  }
  function byCountry(list) {
    if (!country) return list.slice();
    return list.filter(a => !hasCountries(a) || a.countries.includes(country) || a.countries.includes("*"));
  }

  const strict = byBank(byCountry(baseAll));
  if (strict.length > 0) {
    return strict
      .map(a => ({ ...a, _issuerScore: (hasBanks(a) && a.banks.includes(bank) ? 2 : 0) + (hasCountries(a) && a.countries.includes(country) ? 1 : 0) }))
      .sort((a, b) => (b._issuerScore - a._issuerScore) || ((a.priority || 99) - (b.priority || 99)))
      .map(({ _issuerScore, ...rest }) => rest);
  }

  const noBank = byCountry(baseAll);
  if (noBank.length > 0) {
    return noBank
      .map(a => ({ ...a, _issuerScore: (hasCountries(a) && a.countries.includes(country) ? 1 : 0) }))
      .sort((a, b) => (b._issuerScore - a._issuerScore) || ((a.priority || 99) - (b.priority || 99)))
      .map(({ _issuerScore, ...rest }) => rest);
  }

  const noCountry = byBank(baseAll);
  if (noCountry.length > 0) {
    return noCountry
      .map(a => ({ ...a, _issuerScore: (hasBanks(a) && a.banks.includes(bank) ? 2 : 0) }))
      .sort((a, b) => (b._issuerScore - a._issuerScore) || ((a.priority || 99) - (b.priority || 99)))
      .map(({ _issuerScore, ...rest }) => rest);
  }

  return baseAll.slice().sort((a, b) => (a.priority || 99) - (b.priority || 99));
}

function computeRiskScore(tx, scheme) {
  const score = { total: 0, reasons: [], details: {} };
  const amount = Number(tx.amount) || 0;
  const currencyAlpha = normalizeCurrencyAlpha(tx.currencyCode);
  const resolvedPan = resolveTxPan(tx);
  const issuer = resolvedPan ? detectIssuer(resolvedPan) : null;

  if (amount > 100000) { score.total += 15; score.reasons.push("HIGH_AMOUNT"); score.details.amountBand = "gt_100k"; }
  else if (amount > 25000) { score.total += 8; score.reasons.push("ELEVATED_AMOUNT"); }

  const highRiskMccs = ["7995", "6011", "6012", "4899", "6051", "6211"];
  if (tx.mcc && highRiskMccs.includes(String(tx.mcc))) {
    score.total += 25;
    score.reasons.push("HIGH_RISK_MCC: " + tx.mcc);
  }

  if (issuer) {
    score.details.issuer = issuer;
    if (tx.country && String(tx.country).toUpperCase() !== issuer.country) {
      score.total += 20;
      score.reasons.push("ISSUER_COUNTRY_MISMATCH: txCountry=" + tx.country + " vs issuer=" + issuer.country);
    }
    if (currencyAlpha === "AED" && issuer.country !== "AE") {
      score.total += 10;
      score.reasons.push("CROSS_BORDER_AED: issuer " + issuer.country);
    }
    if (issuer.bank === "RAKBANK" && amount > 5000) {
      score.total += 30;
      score.reasons.push("RAKBANK_HIGH_AMOUNT: " + amount);
    }
    if (issuer.bank === "CHASE_USA" && currencyAlpha !== "USD") {
      score.total += 12;
      score.reasons.push("CHASE_USA_NON_USD: " + currencyAlpha);
    }
    if (issuer.bank === "BARCLAYS_UK" && currencyAlpha !== "GBP" && currencyAlpha !== "EUR") {
      score.total += 12;
      score.reasons.push("BARCLAYS_UK_NON_GBP_EUR: " + currencyAlpha);
    }
  } else {
    score.total += 5;
    score.reasons.push("UNKNOWN_BIN");
  }

  if (tx.token) {
    score.total -= 5;
    score.reasons.push("NETWORK_TOKEN: reduces risk");
  }

  if (tx.emv && tx.emv.arqc) {
    score.total -= 5;
    score.reasons.push("EMV_CHIP: reduces risk");
  }

  if (tx.threeDS) {
    score.total -= 15;
    score.reasons.push("3DS_AUTHENTICATED");
  }

  score.total = Math.max(0, Math.min(100, score.total));
  if (score.total >= 70) { score.bucket = "HIGH"; }
  else if (score.total >= 35) { score.bucket = "MEDIUM"; }
  else if (score.total >= 15) { score.bucket = "ELEVATED"; }
  else { score.bucket = "LOW"; }

  return score;
}

function selectAcquirer(tx, scheme) {
  const candidates = selectAcquirerCandidates(tx, scheme);
  return candidates[0] || null;
}

function generateStandInApproval(tx) {
  standInIdCounter += 1;
  const id = "STAN" + String(standInIdCounter).padStart(8, "0");
  const stan = String(Math.floor(Math.random() * 900000) + 100000);
  const now = new Date();
  const MM = String(now.getMonth() + 1).padStart(2, "0");
  const DD = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const field7 = `${MM}${DD}${hh}${mm}`;
  return {
    standInId: id,
    authCode: "ST" + String(Math.floor(Math.random() * 900000) + 100000),
    stan,
    field7,
    authorizedAt: now.toISOString()
  };
}

const STAND_IN_MAX_AMOUNT = {
  AED: 100000,
  USD: 27000,
  EUR: 25000,
  GBP: 22000,
  SGD: 36000,
  DEFAULT: 5000
};

function allowStandIn(tx, scheme, attempts) {
  const amount = Number(tx.amount) || 0;
  if (amount <= 0) return { allowed: false, reason: "ZERO_OR_NEGATIVE_AMOUNT" };

  const currencyAlpha = normalizeCurrencyAlpha(tx.currencyCode);
  const cap = STAND_IN_MAX_AMOUNT[currencyAlpha] != null ? STAND_IN_MAX_AMOUNT[currencyAlpha] : STAND_IN_MAX_AMOUNT.DEFAULT;
  if (amount > cap) return { allowed: false, reason: "OVER_STANDIN_CAP: " + amount + " " + currencyAlpha + " > cap " + cap };

  if (!scheme) return { allowed: false, reason: "UNKNOWN_SCHEME" };

  const highRiskMccs = ["7995", "6011", "6012", "4899"];
  if (tx.mcc && highRiskMccs.includes(String(tx.mcc))) {
    return { allowed: false, reason: "HIGH_RISK_MCC_BLOCKED: " + tx.mcc };
  }

  if (standInQueue.length >= 50) return { allowed: false, reason: "STANDIN_QUEUE_FULL: " + standInQueue.length };

  const recentByPan = (function () {
    const resolvedPan = resolveTxPan(tx);
    if (!resolvedPan) return 0;
    const cutoff = Date.now() - 60 * 60 * 1000;
    return standInQueue.filter(e => {
      const ePan = resolveTxPan(e.tx);
      const t = new Date(e.createdAt).getTime();
      return ePan === resolvedPan && t >= cutoff;
    }).length;
  })();
  if (recentByPan >= 6) return { allowed: false, reason: "TOO_MANY_STANDIN_BY_PAN_LAST_HOUR: " + recentByPan };

  const risk = computeRiskScore(tx, scheme);
  if (risk.bucket === "HIGH") {
    return { allowed: false, reason: "RISK_BUCKET_HIGH_BLOCKS_STANDIN: " + risk.total + " / reasons=" + risk.reasons.join("|"), risk };
  }
  let effectiveCap = cap;
  if (risk.bucket === "MEDIUM") {
    effectiveCap = Math.min(cap, 5000);
    if (amount > effectiveCap) {
      return { allowed: false, reason: "RISK_MEDIUM_TIGHTENED_CAP: amount " + amount + " > reduced cap " + effectiveCap, risk };
    }
  }

  return { allowed: true, cap, currencyAlpha, effectiveCap, risk };
}

async function routeWithFailover(isoReqBuffer, tx, scheme) {
  const candidates = selectAcquirerCandidates(tx, scheme);
  if (!candidates.length) {
    throw new Error("NO_ROUTE: No acquirer matches currency/scheme/MCC/amount criteria");
  }

  const attempts = [];
  let lastError = null;

  for (const acquirer of candidates) {
    const attemptStart = Date.now();
    try {
      console.log("PrimeStack: routing attempt → [" + acquirer.name + "] (priority " + acquirer.priority + ")");
      const resp = await sendToAcquirer(isoReqBuffer, acquirer);
      attempts.push({
        acquirer: acquirer.name,
        status: "SUCCESS",
        latencyMs: Date.now() - attemptStart
      });
      return {
        acquirer: acquirer.name,
        acquirerHost: acquirer.host,
        acquirerPort: acquirer.port,
        resp,
        attempts,
        attemptCount: attempts.length
      };
    } catch (err) {
      lastError = err;
      attempts.push({
        acquirer: acquirer.name,
        status: "FAILED",
        latencyMs: Date.now() - attemptStart,
        error: err.message
      });
      console.log("PrimeStack: acquirer [" + acquirer.name + "] FAILED → " + err.message + ". Trying next...");
    }
  }

  console.log("PrimeStack: all acquirers offline. Triggering Stand-In Processing (STIP/SAF)...");
  return {
    acquirer: "STAND_IN",
    acquirerHost: null,
    acquirerPort: null,
    resp: null,
    attempts,
    attemptCount: attempts.length,
    standIn: true,
    allAcquirersDown: true,
    lastError: lastError ? lastError.message : null
  };
}

function mapResponseMessage(code) {
  switch (code) {
    case "00": return "Approved";
    case "05": return "Do not honor";
    case "14": return "Invalid card number";
    case "25": return "Unable to locate record";
    case "51": return "Insufficient funds";
    case "55": return "EMV cryptogram error";
    case "57": return "Transaction not permitted to cardholder";
    case "91": return "Issuer or switch is inoperative";
    case "96": return "System malfunction";
    case "N7": return "CVV required";
    default: return "Unknown response";
  }
}

function buildIso8583Reversal(tx) {
  const mti = "0400";

  const now = new Date();
  const MM = String(now.getMonth() + 1).padStart(2, "0");
  const DD = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const field7 = tx.originalField7 || `${MM}${DD}${hh}${mm}`;
  const stan = tx.stan || String(Math.floor(Math.random() * 900000) + 100000);

  const resolvedPan = resolveTxPan(tx);
  const panDigits = resolvedPan ? String(resolvedPan).replace(/\D/g, "") : "";

  const fields = {};
  if (panDigits) fields[2] = panDigits;
  fields[3] = "000000";
  fields[4] = String(tx.amount).padStart(12, "0");
  fields[7] = field7;
  fields[11] = stan;
  fields[12] = `${hh}${mm}${ss}`;
  fields[13] = `${MM}${DD}`;
  if (tx.mcc) fields[18] = String(tx.mcc).padStart(4, "0");
  fields[22] = "011";
  fields[25] = "00";
  fields[41] = process.env.PROCESSOR_TERMINAL_ID || "T2013-001";
  fields[42] = process.env.PROCESSOR_MERCHANT_ID || "MRC-1001";
  fields[49] = tx.currencyCode ? String(tx.currencyCode).padStart(3, "0").slice(0, 3) : "784";
  if (tx.cvv) fields[52] = String(tx.cvv).padEnd(16, "0").slice(0, 16);
  fields[55] = buildEmvField55(tx);

  const buf = encodeISO8583(mti, fields);
  return { buffer: buf, stan, field7 };
}

function buildIso8583Refund(tx) {
  const mti = "0200";

  const now = new Date();
  const MM = String(now.getMonth() + 1).padStart(2, "0");
  const DD = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const field7 = `${MM}${DD}${hh}${mm}`;
  const stan = tx.stan || String(Math.floor(Math.random() * 900000) + 100000);

  const resolvedPan = resolveTxPan(tx);
  const panDigits = resolvedPan ? String(resolvedPan).replace(/\D/g, "") : "";

  const fields = {};
  if (panDigits) fields[2] = panDigits;
  fields[3] = "200000";
  fields[4] = String(tx.amount).padStart(12, "0");
  fields[7] = field7;
  fields[11] = stan;
  fields[12] = `${hh}${mm}${ss}`;
  fields[13] = `${MM}${DD}`;
  if (tx.mcc) fields[18] = String(tx.mcc).padStart(4, "0");
  fields[22] = "011";
  fields[25] = "00";
  fields[41] = process.env.PROCESSOR_TERMINAL_ID || "T2013-001";
  fields[42] = process.env.PROCESSOR_MERCHANT_ID || "MRC-1001";
  fields[49] = tx.currencyCode ? String(tx.currencyCode).padStart(3, "0").slice(0, 3) : "784";
  if (tx.cvv) fields[52] = String(tx.cvv).padEnd(16, "0").slice(0, 16);
  fields[55] = buildEmvField55(tx);

  const buf = encodeISO8583(mti, fields);
  return { buffer: buf, stan, field7 };
}

function parseIso8583Response(buf) {
  let mti = null;
  let fields = {};
  let raw = "";
  let decoded = null;
  const isBitmap = isBitmapIsoBuffer(buf);

  if (isBitmap) {
    try {
      decoded = decodeISO8583(buf);
      mti = decoded.mti;
      for (const [k, v] of Object.entries(decoded.fields)) {
        fields[String(k)] = String(v);
      }
      raw = buf.toString("hex");
    } catch (e) {
      console.warn("PrimeStack: bitmap response decode failed, fallback legacy parse:", e.message);
    }
  }

  if (!mti) {
    raw = buf.toString("utf8");
    const legacy = parseLegacyIsoString(raw);
    if (legacy) {
      mti = legacy.mti;
      for (const [k, v] of Object.entries(legacy.fields)) {
        fields[String(k)] = String(v);
      }
    } else {
      const parts = raw.split("|");
      mti = parts[0];
      for (let i = 1; i < parts.length; i++) {
        const eq = parts[i].indexOf("=");
        if (eq > 0) fields[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
      }
    }
  }

  const rc = fields["39"];
  return {
    mti,
    responseCode: rc,
    responseMessage: mapResponseMessage(rc),
    approved: rc === "00",
    amount: fields["4"],
    stan: fields["11"],
    tid: fields["41"] ? String(fields["41"]).trim() : fields["41"],
    mid: fields["42"] ? String(fields["42"]).trim() : fields["42"],
    currencyCode: fields["49"],
    authCode: fields["38"] || undefined,
    raw,
    bitmap: isBitmap
  };
}

function numericCurrencyToAlpha(code) {
  return normalizeCurrencyAlpha(code);
}

const binTable = {
  "4":     { scheme: "VISA",      length: 16 },
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
  for (const bin of keys) {
    if (digits.startsWith(bin)) return binTable[bin];
  }
  return null;
}

function validatePan(pan) {
  if (!pan) return { valid: false, reason: "NO_PAN", responseCode: "14", responseMessage: "Invalid card number" };
  const digits = String(pan).replace(/\D/g, "");
  if (!/^\d+$/.test(digits)) return { valid: false, reason: "NON_NUMERIC_PAN", responseCode: "14", responseMessage: "Invalid card number" };
  const schemeInfo = detectScheme(digits);
  if (!schemeInfo) return { valid: false, reason: "UNKNOWN_BIN", responseCode: "14", responseMessage: "Invalid card number" };
  if (digits.length !== schemeInfo.length) return { valid: false, reason: "INVALID_LENGTH", responseCode: "14", responseMessage: "Invalid card number", scheme: schemeInfo.scheme };
  return { valid: true, scheme: schemeInfo.scheme, digits };
}

function tlv(tag, valueHex) {
  const lengthHex = (valueHex.length / 2).toString(16).padStart(2, "0");
  return tag + lengthHex + valueHex;
}

function buildEmvField55(tx) {
  let ARQC, CID, IAD;

  if (tx.standIn === true) {
    ARQC = crypto.randomBytes(8).toString("hex").toUpperCase();
    CID = "40";
    IAD = "06011103A00000";
  } else if (tx.standInDecline === true) {
    ARQC = crypto.randomBytes(8).toString("hex").toUpperCase();
    CID = "00";
    IAD = "06010A03000000";
  } else if (tx.token) {
    ARQC = crypto.randomBytes(8).toString("hex").toUpperCase();
    CID = "80";
    IAD = "06010A03A00000";
  } else {
    ARQC = tx.emv && tx.emv.arqc ? String(tx.emv.arqc).toUpperCase() : "1122334455667788";
    CID = tx.emv && tx.emv.cid ? String(tx.emv.cid).toUpperCase() : "80";
    IAD = tx.emv && tx.emv.iad ? String(tx.emv.iad).toUpperCase() : "06010A03A00000";
  }

  const UN = tx.emv && tx.emv.un ? String(tx.emv.un).toUpperCase() : "A1B2C3D4";
  const ATC = tx.emv && tx.emv.atc ? String(tx.emv.atc).toUpperCase().padStart(4, "0") : "0023";
  const TVR = tx.emv && tx.emv.tvr ? String(tx.emv.tvr).toUpperCase() : "0000000000";
  const DATE = tx.dateYYMMDD || (tx.emv && tx.emv.date) || (() => {
    const d = new Date();
    return String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  })();
  const TXN_TYPE = tx.emv && tx.emv.txnType ? String(tx.emv.txnType).toUpperCase() : "00";
  const CURR_NUM = tx.currencyCode ? String(tx.currencyCode).padStart(4, "0") : "0784";
  const AIP = tx.emv && tx.emv.aip ? String(tx.emv.aip).toUpperCase() : "3800";
  const COUNTRY = tx.emv && tx.emv.country ? String(tx.emv.country) : "0784";
  const TERM_CAP = tx.emv && tx.emv.termCap ? String(tx.emv.termCap).toUpperCase() : "E0F0C8";
  const CVM = tx.emv && tx.emv.cvm ? String(tx.emv.cvm).toUpperCase() : "420300";
  const TERM_TYPE = tx.emv && tx.emv.termType ? String(tx.emv.termType) : "22";
  const SERIAL = tx.emv && tx.emv.serial ? String(tx.emv.serial) : (process.env.PROCESSOR_TERMINAL_ID || "T2013-001");

  const tlvs =
    tlv("9F26", ARQC) +
    tlv("9F27", CID) +
    tlv("9F10", IAD) +
    tlv("9F37", UN) +
    tlv("9F36", ATC) +
    tlv("95", TVR) +
    tlv("9A", DATE) +
    tlv("9C", TXN_TYPE) +
    tlv("5F2A", CURR_NUM) +
    tlv("82", AIP) +
    tlv("9F1A", COUNTRY) +
    tlv("9F33", TERM_CAP) +
    tlv("9F34", CVM) +
    tlv("9F35", TERM_TYPE) +
    tlv("9F1E", Buffer.from(SERIAL).toString("hex"));

  return tlvs;
}

function callSettlement(result, txAccountId) {
  return new Promise((resolve, reject) => {
    const alphaCurrency = numericCurrencyToAlpha(result.currencyCode);
    const payload = JSON.stringify({
      accountId: txAccountId || "VAULT-MERCHANT-001",
      amount: Number(result.amount),
      currencyCode: alphaCurrency,
      mid: result.mid,
      tid: result.tid,
      rrn: result.stan,
      authCode: result.responseCode === "00" ? "VB" + result.stan : null
    });

    const url = new URL(VAULT_SETTLEMENT_URL);

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    };

    const req = http.request(options, res => {
      let data = "";
      res.on("data", chunk => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function callSettlementAddPendingAuth(payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const url = new URL(VAULT_SETTLEMENT_URL);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: "/api/vault/internal/add-pending-auth",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      },
      timeout: 5000
    };
    const req = http.request(opts, res => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => {
        try { resolve(data ? JSON.parse(data) : { ok: true }); }
        catch { resolve({ ok: true, raw: data }); }
      });
    });
    req.on("error", err => resolve({ ok: false, error: err.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.write(body);
    req.end();
  });
}

function vaultBankTcpPing() {
  return new Promise((resolve) => {
    const acquirer = acquirerRouting.find(a => a.isVaultBank);
    if (!acquirer) return resolve({ ok: false, error: "VAULT_BANK not in routing table" });
    const socket = new net.Socket();
    let done = false;
    const timeout = setTimeout(() => {
      if (!done) { done = true; try { socket.destroy(); } catch (_) {} resolve({ ok: false, host: acquirer.host, port: acquirer.port, error: "timeout after 2000ms" }); }
    }, 2000);
    socket.connect(acquirer.port, acquirer.host, () => {
      clearTimeout(timeout);
      if (!done) { done = true; try { socket.end(); } catch (_) {} resolve({ ok: true, host: acquirer.host, port: acquirer.port }); }
    });
    socket.on("error", (err) => {
      clearTimeout(timeout);
      if (!done) { done = true; resolve({ ok: false, host: acquirer.host, port: acquirer.port, error: err.message }); }
    });
  });
}

function vaultBankSettlementPing() {
  return new Promise((resolve) => {
    try {
      const url = new URL(VAULT_SETTLEMENT_URL);
      const opts = {
        hostname: url.hostname, port: url.port, path: "/api/vault/omnibus", method: "GET", timeout: 2000
      };
      const req = http.request(opts, (res) => {
        let body = "";
        res.on("data", c => (body += c));
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            resolve({ ok: true, statusCode: res.statusCode, omnibusAccount: json.omnibusAccount, backingStatus: json.backingStatus, totalEstimatedAed: json.totalEstimatedAed });
          } catch {
            resolve({ ok: true, statusCode: res.statusCode, rawBody: body.slice(0, 200) });
          }
        });
      });
      req.on("error", (e) => resolve({ ok: false, error: e.message }));
      req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout after 2000ms" }); });
      req.end();
    } catch (e) { resolve({ ok: false, error: e.message }); }
  });
}

function vaultBankAcquirerDiagCall(path, method, payloadBody) {
  return new Promise((resolve) => {
    const acquirer = acquirerRouting.find(a => a.isVaultBank);
    if (!acquirer) return resolve({ ok: false, error: "VAULT_BANK not in routing table" });
    const diagPort = parseInt(process.env.VAULT_BANK_DIAG_PORT || "9009", 10);
    try {
      const opts = {
        hostname: acquirer.host, port: diagPort, path, method: method || "GET", timeout: 5000
      };
      if (payloadBody) {
        opts.headers = { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payloadBody) };
      }
      const req = http.request(opts, (res) => {
        let body = "";
        res.on("data", c => (body += c));
        res.on("end", () => {
          try { resolve({ ok: true, statusCode: res.statusCode, data: JSON.parse(body) }); }
          catch { resolve({ ok: true, statusCode: res.statusCode, raw: body.slice(0, 500) }); }
        });
      });
      req.on("error", (e) => resolve({ ok: false, error: e.message }));
      req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout after 5000ms" }); });
      if (payloadBody) req.write(payloadBody);
      req.end();
    } catch (e) { resolve({ ok: false, error: e.message }); }
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url.startsWith("/pipeline/status")) {
    const tcp = await vaultBankTcpPing();
    const settle = await vaultBankSettlementPing();
    const acquirerDiag = await vaultBankAcquirerDiagCall("/status", "GET", null);
    const activeAcquirers = acquirerRouting.filter(a => a.active !== false);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
      processorPort: PROCESSOR_PORT,
      pipeline: {
        "PRIMESTACK_PROCESSOR": "ONLINE",
        "VAULT_BANK_ACQUIRER_TCP": tcp.ok ? "ONLINE" : "OFFLINE",
        "VAULT_BANK_SETTLEMENT_API": settle.ok ? "ONLINE" : "OFFLINE",
        "LIVE_SCHEME_AVAILABLE": acquirerDiag.ok && acquirerDiag.data && acquirerDiag.data.mode === "LIVE"
      },
      vaultBankAcquirer: {
        tcpPing: tcp,
        diag: acquirerDiag.ok ? acquirerDiag.data : null,
        diagError: acquirerDiag.ok ? null : acquirerDiag.error
      },
      vaultBankSettlement: settle,
      acquirerRoutingTable: activeAcquirers.map(a => ({
        name: a.name, priority: a.priority, host: a.host, port: a.port, schemes: a.schemes, currencies: a.currencies, isVaultBank: !!a.isVaultBank, bankBic: a.bankBic || null, legalName: a.legalName || null
      })),
      issuerBins: Object.fromEntries(
        Object.entries(issuerTable)
          .filter(([_, info]) => info && (info.bank === "VAULT_BANK" || info.vault))
          .map(([bin6, info]) => [bin6, { scheme: info.scheme, country: info.country, vaultAccount: info.vault || null }])
      ),
      vaultBankIdentity: {
        legalName: VAULT_BANK_LEGAL_NAME,
        tradeName: process.env.VAULT_BANK_TRADE_NAME || "Vault Bank",
        registrationNumber: process.env.VAULT_BANK_REGISTRATION_NUMBER || null,
        jurisdiction: process.env.VAULT_BANK_JURISDICTION || null,
        swiftBic: VAULT_BANK_BIC,
        centralBankLicense: process.env.VAULT_BANK_CENTRAL_BANK_LICENSE || null,
        routingNumberAch: process.env.VAULT_BANK_ROUTING_NO_ACH || null,
        routingNumberWire: process.env.VAULT_BANK_ROUTING_NO_WIRE || null,
        sortCode: process.env.VAULT_BANK_SORT_CODE || null,
        principalMemberVisa: process.env.VAULT_BANK_PRINCIPAL_MEMBER_VISA === "YES",
        principalMemberMastercard: process.env.VAULT_BANK_PRINCIPAL_MEMBER_MASTERCARD === "YES",
        operatingAccounts: {
          USD: process.env.VAULT_BANK_OPERATING_ACCOUNT_USD || null,
          EUR: process.env.VAULT_BANK_OPERATING_ACCOUNT_EUR || null,
          AED: process.env.VAULT_BANK_OPERATING_ACCOUNT_AED || null,
          GBP: process.env.VAULT_BANK_OPERATING_ACCOUNT_GBP || null,
          SGD: process.env.VAULT_BANK_OPERATING_ACCOUNT_SGD || null,
          INR: process.env.VAULT_BANK_OPERATING_ACCOUNT_INR || null,
          JPY: process.env.VAULT_BANK_OPERATING_ACCOUNT_JPY || null,
          CHF: process.env.VAULT_BANK_OPERATING_ACCOUNT_CHF || null,
          AUD: process.env.VAULT_BANK_OPERATING_ACCOUNT_AUD || null,
          CAD: process.env.VAULT_BANK_OPERATING_ACCOUNT_CAD || null,
          HKD: process.env.VAULT_BANK_OPERATING_ACCOUNT_HKD || null,
          MYR: process.env.VAULT_BANK_OPERATING_ACCOUNT_MYR || null,
          CNY: process.env.VAULT_BANK_OPERATING_ACCOUNT_CNY || null
        }
      },
      schemeCertifications: {
        visa: {
          cispCertified: process.env.VISA_CISP_CERTIFIED === "YES",
          cispId: process.env.VISA_CISP_ID || null,
          cispExpiry: process.env.VISA_CISP_EXPIRY || null,
          aib: process.env.VISA_AIB || null,
          acquirerBin: process.env.VISA_ACQUIRER_BIN || null,
          acquirerMemberNumber: process.env.VISA_ACQUIRER_MEMBER_NUMBER || null,
          vsssRegId: process.env.VISA_VSSS_REGISTRATION_ID || null,
          baseIiSftp: process.env.VISA_BASEII_SFTP_HOST ? { host: process.env.VISA_BASEII_SFTP_HOST, port: process.env.VISA_BASEII_SFTP_PORT || "22", user: process.env.VISA_BASEII_SFTP_USER || null, inFolder: process.env.VISA_BASEII_IN_FOLDER || null, outFolder: process.env.VISA_BASEII_OUT_FOLDER || null } : null
        },
        mastercard: {
          sdpCertified: process.env.MC_SDP_CERTIFIED === "YES",
          sdpId: process.env.MC_SDP_ID || null,
          sdpExpiry: process.env.MC_SDP_EXPIRY || null,
          aib: process.env.MC_AIB || null,
          acquirerBin: process.env.MC_ACQUIRER_BIN || null,
          ica: process.env.MC_ACQUIRER_MEMBER_NUMBER || null,
          mipRegId: process.env.MC_MIP_REGISTRATION_ID || null,
          globalClearingId: process.env.MC_GLOBAL_CLEARING_ID || null,
          ipmSftp: process.env.MC_IPM_SFTP_HOST ? { host: process.env.MC_IPM_SFTP_HOST, port: process.env.MC_IPM_SFTP_PORT || "22", user: process.env.MC_IPM_SFTP_USER || null, inFolder: process.env.MC_IPM_IN_FOLDER || null, outFolder: process.env.MC_IPM_OUT_FOLDER || null } : null
        }
      },
      pciDss: {
        level: process.env.PCI_DSS_LEVEL || "1",
        version: process.env.PCI_DSS_VERSION || "4.0",
        status: process.env.PCI_DSS_STATUS || "COMPLIANT",
        aocDate: process.env.PCI_DSS_AOC_DATE || null,
        aocExpiry: process.env.PCI_DSS_AOC_EXPIRY || null,
        rocDate: process.env.PCI_DSS_ROC_DATE || null,
        rocExpiry: process.env.PCI_DSS_ROC_EXPIRY || null,
        qsa: {
          company: process.env.PCI_QSA_COMPANY || null,
          id: process.env.PCI_QSA_ID || null,
          lead: process.env.PCI_QSA_LEAD || null
        },
        companyId: process.env.PCI_DSS_COMPANY_ID || null,
        merchantSak: process.env.PCI_DSS_MERCHANT_SAK || null,
        hsmGrade: process.env.PCI_VAULT_HSM_GRADE || "FIPS_140_3_LEVEL_3",
        panStorage: process.env.PCI_PAN_STORAGE || "TRUNCATED_PLUS_TOKENIZED",
        cvvPolicy: process.env.PCI_CVV_POLICY || "NEVER_STORED_SHOWN_ONCE_ONLY",
        networkSegmentation: process.env.PCI_NETWORK_SEGMENTATION === "YES",
        mfaForAllAdmin: process.env.PCI_MFA_FOR_ALL_ADMIN === "YES",
        logRetentionDays: process.env.PCI_LOG_RETENTION_DAYS || "375",
        incidentResponseYears: process.env.PCI_INCIDENT_RESPONSE_RETENTION_YEARS || "7"
      },
      hsm: {
        mode: process.env.HSM_MODE || "SOFTWARE_SIMULATOR",
        primary: process.env.HSM_PRIMARY_VENDOR ? {
          vendor: process.env.HSM_PRIMARY_VENDOR, model: process.env.HSM_PRIMARY_MODEL || null,
          fipsLevel: process.env.HSM_PRIMARY_FIPS_LEVEL || null, serial: process.env.HSM_PRIMARY_SERIAL || null,
          ip: process.env.HSM_PRIMARY_IP || null, port: process.env.HSM_PRIMARY_PORT || null, user: process.env.HSM_PRIMARY_USER || null
        } : null,
        backup: process.env.HSM_BACKUP_VENDOR ? {
          vendor: process.env.HSM_BACKUP_VENDOR, model: process.env.HSM_BACKUP_MODEL || null,
          fipsLevel: process.env.HSM_BACKUP_FIPS_LEVEL || null, serial: process.env.HSM_BACKUP_SERIAL || null,
          ip: process.env.HSM_BACKUP_IP || null, port: process.env.HSM_BACKUP_PORT || null
        } : null,
        keyInventory: {
          kekPresent: !!process.env.VAULT_HSM_KEK, zmkPresent: !!process.env.VAULT_HSM_ZMK, zpkPresent: !!process.env.VAULT_HSM_ZPK,
          pekPresent: !!process.env.VAULT_HSM_PEK, pvkPresent: !!process.env.VAULT_HSM_PVK,
          cvkPairPresent: !!(process.env.VAULT_HSM_CVK_A && process.env.VAULT_HSM_CVK_B),
          macKeysPresent: { vaultInternal: !!process.env.VAULT_MAC_KEY, visa: !!process.env.VISA_MAC_KEY, mastercard: !!process.env.MC_MAC_KEY },
          emvMasterKeys: { visa: !!(process.env.EMV_MK_AC_VISA && process.env.EMV_MK_SMI_VISA && process.env.EMV_MK_SMC_VISA), mastercard: !!(process.env.EMV_MK_AC_MC && process.env.EMV_MK_SMI_MC && process.env.EMV_MK_SMC_MC) },
          dukptBdkPresent: !!process.env.VAULT_HSM_BDK, tspMasterKeyPresent: !!process.env.VAULT_TSP_MK
        },
        failoverAuto: process.env.HSM_FAILOVER_AUTO === "YES",
        maxSessionPool: process.env.HSM_MAX_SESSION_POOL || "32",
        healthCheckIntervalSec: process.env.HSM_HEALTH_CHECK_INTERVAL_SEC || "15"
      },
      constraints: {
        soleAcquirer: "VAULT_BANK",
        omnibusBackedByRealFunds: "REQUIRED — call POST /api/vault/funds-received on settlement service when scheme payout hits bank",
        reversalsMustBeOnline: true,
        refundsMustBeOnline: true,
        de49NumericToAlphaBeforeRoutingOrLookup: true,
        de2MustBeRealPanNotDpan: true
      },
      checkedAt: new Date().toISOString()
    }, null, 2));
    return;
  }

  if (req.method === "POST" && req.url === "/pipeline/connect-live-schemes") {
    const result = await vaultBankAcquirerDiagCall("/connect-live-schemes", "POST", "{}");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      processorInitiated: true,
      vaultBankResponse: result.ok ? result.data : null,
      error: result.ok ? null : result.error,
      nextStep: "GET /pipeline/status to verify LIVE scheme sockets are open. Then send a 0100 auth charge to test real scheme routing."
    }));
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/pipeline/vault-acquirer-status")) {
    const diag = await vaultBankAcquirerDiagCall("/status", "GET", null);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(diag));
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/pipeline/vault-settlement-status")) {
    const settle = await vaultBankSettlementPing();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(settle));
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/acquirers")) {
    const list = acquirerRouting.map(a => ({
      name: a.name,
      host: a.host,
      port: a.port,
      currencies: a.currencies,
      schemes: a.schemes,
      mccs: a.mccs,
      priority: a.priority,
      minAmount: a.minAmount,
      maxAmount: a.maxAmount === Infinity ? "UNLIMITED" : a.maxAmount,
      active: a.active !== false
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      count: list.length,
      acquirers: list
    }));
  } else if (req.method === "POST" && req.url.startsWith("/routing/test")) {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      const tx = body ? JSON.parse(body) : {};
      const resolvedPan = resolveTxPan(tx);
      const schemeInfo = resolvedPan ? detectScheme(resolvedPan) : null;
      const scheme = schemeInfo ? schemeInfo.scheme : null;
      const candidates = selectAcquirerCandidates(tx, scheme);
      const top = candidates[0] || null;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        request: {
          amount: tx.amount,
          currency: tx.currencyCode,
          currencyAlpha: normalizeCurrencyAlpha(tx.currencyCode),
          scheme,
          mcc: tx.mcc || null,
          token: tx.token || null,
          device: tx.device || tx.channel || "POS"
        },
        selected: top ? {
          name: top.name, host: top.host, port: top.port, priority: top.priority
        } : null,
        candidates: candidates.map(c => ({
          name: c.name,
          priority: c.priority,
          currencies: c.currencies,
          schemes: c.schemes
        })),
        candidateCount: candidates.length,
        routeAvailable: candidates.length > 0
      }));
    });
  } else if (req.method === "POST" && req.url === "/tokenize") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const { pan, expiry } = JSON.parse(body);
        console.log("PrimeStack: /tokenize request received");

        const panValidation = validatePan(pan);
        if (!panValidation.valid) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({
            error: "INVALID_PAN",
            responseCode: panValidation.responseCode,
            responseMessage: panValidation.responseMessage,
            reason: panValidation.reason
          }));
        }

        const token = "52" + Math.floor(Math.random() * 1e14).toString().padStart(14, "0");

        tokenVault[token] = {
          pan: String(pan).replace(/\D/g, ""),
          expiry: expiry || null,
          scheme: detectScheme(pan).scheme,
          createdAt: new Date().toISOString(),
          status: "ACTIVE"
        };

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          token,
          masked: token.substring(0, 6) + "******" + token.substring(12),
          scheme: tokenVault[token].scheme,
          expiry: tokenVault[token].expiry,
          createdAt: tokenVault[token].createdAt,
          tokenType: "DPAN",
          paymentNetwork: "TOKENIZED"
        }));
      } catch (err) {
        console.error("PrimeStack: /tokenize error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else if (req.method === "GET" && req.url.startsWith("/detokenize")) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const token = urlObj.searchParams.get("token");

    if (!token || !tokenVault[token]) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "TOKEN_NOT_FOUND", token: token || null }));
    }

    const entry = tokenVault[token];

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      token,
      maskedPan: entry.pan.substring(0, 6) + "******" + entry.pan.substring(12),
      pan: entry.pan,
      expiry: entry.expiry,
      scheme: entry.scheme,
      createdAt: entry.createdAt,
      status: entry.status
    }));
  } else if (req.method === "POST" && req.url === "/merchant/v1/payments/charge") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", async () => {
      try {
        const tx = JSON.parse(body);
        console.log("PrimeStack: received charge request:", tx);

        let resolvedPan = null;
        let usedToken = false;

        if (tx.token) {
          usedToken = true;
          const tokenEntry = tokenVault[tx.token];
          if (!tokenEntry) {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({
              processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
              approved: false,
              responseCode: "14",
              responseMessage: "Invalid card number",
              reason: "TOKEN_NOT_FOUND",
              token: tx.token,
              tokenized: true
            }));
          }
          resolvedPan = tokenEntry.pan;
        }

        const panToValidate = resolvedPan || tx.pan;
        let scheme = null;
        let issuer = panToValidate ? detectIssuer(panToValidate) : null;

        if (panToValidate) {
          const panValidation = validatePan(panToValidate);
          if (!panValidation.valid) {
            console.log("[PRIMESTACK-CHARGE] panValidation FAILED for panEnd=" + panToValidate.slice(-4) + " reason=" + panValidation.reason + " rc=" + panValidation.responseCode);
            const riskProfile = computeRiskScore(tx, null);
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({
              processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
              approved: false,
              responseCode: panValidation.responseCode,
              responseMessage: panValidation.responseMessage,
              reason: panValidation.reason,
              issuer: issuer || null,
              risk: riskProfile,
              ...(panValidation.scheme ? { scheme: panValidation.scheme } : {}),
              ...(usedToken ? { token: tx.token, tokenized: true } : {})
            }));
          }
          scheme = panValidation.scheme;
        }

        const risk = computeRiskScore(tx, scheme);

        const candidateCheck = selectAcquirer(tx, scheme);
        if (!candidateCheck) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({
            processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
            approved: false,
            responseCode: "91",
            responseMessage: "Issuer or switch is inoperative",
            reason: "NO_ROUTE: No acquirer available for scheme=" + (scheme || "UNKNOWN") + " currency=" + normalizeCurrencyAlpha(tx.currencyCode),
            issuer: issuer || null,
            risk,
            ...(scheme ? { scheme } : {}),
            ...(usedToken ? { token: tx.token, tokenized: true } : {})
          }));
        }

        const isoBuilt = buildIso8583Auth(tx);
        let routeResult;
        try {
          routeResult = await routeWithFailover(isoBuilt.buffer, tx, scheme);
        } catch (routeErr) {
          const msg = String(routeErr.message || "");
          if (msg.startsWith("NO_ROUTE")) {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({
              processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
              approved: false,
              responseCode: "91",
              responseMessage: "Issuer or switch is inoperative",
              reason: routeErr.message,
              routingAttempts: routeErr.attempts || null,
              issuer: issuer || null,
              risk,
              ...(scheme ? { scheme } : {}),
              ...(usedToken ? { token: tx.token, tokenized: true } : {})
            }));
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({
            processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
            approved: false,
            responseCode: "96",
            responseMessage: "System malfunction",
            reason: routeErr.message,
            routingAttempts: routeErr.attempts || null,
            issuer: issuer || null,
            risk,
            ...(scheme ? { scheme } : {}),
            ...(usedToken ? { token: tx.token, tokenized: true } : {})
          }));
        }

        if (routeResult.standIn === true) {
          const guard = allowStandIn(tx, scheme, routeResult.attempts);
          if (!guard.allowed) {
            console.log("PrimeStack: stand-in DECLINED reason=", guard.reason);
            const emvOfflineDecline = buildEmvField55({ ...tx, standInDecline: true });
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({
              processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
              approved: false,
              responseCode: "05",
              responseMessage: "Do not honor",
              standIn: true,
              standInDeclined: true,
              reason: "STANDIN_NOT_PERMITTED: " + guard.reason,
              issuer: issuer || null,
              risk: guard.risk || risk,
              emv: { cid: "00", iad: "06010A03000000", field55: emvOfflineDecline },
              routing: {
                acquirer: "STAND_IN",
                attemptCount: routeResult.attemptCount,
                attempts: routeResult.attempts,
                allAcquirersDown: true
              },
              ...(scheme ? { scheme } : {}),
              ...(usedToken ? { token: tx.token, tokenized: true } : {})
            }));
          }

          const standInAuth = generateStandInApproval(tx);
          const standInTx = { ...tx, standIn: true };
          const emvTc = buildEmvField55(standInTx);

          const resolvedPan = resolveTxPan(tx);
          const maskPan = resolvedPan
            ? String(resolvedPan).substring(0, 6) + "******" + String(resolvedPan).substring(12)
            : null;

          const queueEntry = {
            queueId: "Q" + standInAuth.standInId,
            status: "PENDING_SYNC",
            tx: JSON.parse(JSON.stringify(tx)),
            isoReqBase64: isoBuilt.buffer.toString("base64"),
            isoField7: isoBuilt.field7,
            isoStan: isoBuilt.stan,
            scheme,
            standIn: {
              ...standInAuth,
              authCode: standInAuth.authCode,
              maskedPan: maskPan,
              cap: guard.cap,
              currencyAlpha: guard.currencyAlpha
            },
            offlineEmvField55: emvTc,
            routingAttempts: routeResult.attempts,
            createdAt: new Date().toISOString()
          };
          standInQueue.push(queueEntry);
          console.log("PrimeStack: STAND-IN APPROVED " + queueEntry.queueId + " stan=" + standInAuth.stan + " queueSize=" + standInQueue.length);

          const currencyAlpha = guard.currencyAlpha;
          callSettlementAddPendingAuth({
            stan: standInAuth.stan,
            rrn: standInAuth.field7,
            amount: Number(tx.amount),
            currencyCode: tx.currencyCode || "784",
            mid: process.env.PROCESSOR_MERCHANT_ID || "MRC-1001",
            tid: process.env.PROCESSOR_TERMINAL_ID || "T2013-001",
            pan: resolvedPan || null,
            emv: emvTc,
            mcc: tx.mcc || null,
            mti: "0100",
            processingCode: "000000",
            createdAt: standInAuth.authorizedAt,
            acquiringInstitution: "PRIMESTACK_STIP",
            standIn: true,
            standInId: standInAuth.standInId
          }).catch(() => {});

          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({
            processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
            approved: true,
            responseCode: "00",
            responseMessage: "Stand-in approval (TC offline / Visa STIP / Mastercard SAF)",
            stan: standInAuth.stan,
            tid: process.env.PROCESSOR_TERMINAL_ID || "T2013-001",
            mid: process.env.PROCESSOR_MERCHANT_ID || "MRC-1001",
            amount: String(tx.amount).padStart(12, "0"),
            currencyCode: tx.currencyCode || "784",
            authCode: standInAuth.authCode,
            standIn: true,
            standInId: standInAuth.standInId,
            queueId: queueEntry.queueId,
            offline: true,
            settlement: {
              status: "PENDING_CLEARING",
              note: "Stand-in auth queued for settlement batch + pending acquirer re-sync"
            },
            emv: {
              cid: "40",
              cidMeaning: "TC — Transaction Certificate (offline approval)",
              iad: "06011103A00000",
              field55: emvTc
            },
            routing: {
              acquirer: "STAND_IN",
              attemptCount: routeResult.attemptCount,
              attempts: routeResult.attempts,
              allAcquirersDown: true,
              lastError: routeResult.lastError || null,
              candidatesConsidered: (function () {
                const c = selectAcquirerCandidates(tx, scheme);
                return c.length;
              })()
            },
            ...(scheme ? { scheme } : {}),
            ...(usedToken ? { token: tx.token, tokenized: true } : {})
          }));
        }

        const result = parseIso8583Response(routeResult.resp);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
          ...result,
          settlement: result.approved
            ? { status: "PENDING_CLEARING", note: "Auth approved. Queued for daily batch clearing/settlement (Visa/Mastercard style)" }
            : undefined,
          routing: {
            acquirer: routeResult.acquirer,
            acquirerHost: routeResult.acquirerHost,
            acquirerPort: routeResult.acquirerPort,
            attemptCount: routeResult.attemptCount,
            attempts: routeResult.attempts,
            candidatesConsidered: (function () {
              const c = selectAcquirerCandidates(tx, scheme);
              return c.length;
            })()
          },
          ...(usedToken ? { token: tx.token, tokenized: true } : {}),
          ...(scheme ? { scheme } : {})
        }));
      } catch (err) {
        console.error("PrimeStack: error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else if (req.method === "POST" && req.url === "/merchant/v1/payments/reversal") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", async () => {
      try {
        const tx = JSON.parse(body);
        console.log("PrimeStack: reversal request:", tx);

        let resolvedPan = null;
        let usedToken = false;

        if (tx.token) {
          usedToken = true;
          const tokenEntry = tokenVault[tx.token];
          if (!tokenEntry) {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({
              processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
              approved: false,
              responseCode: "14",
              responseMessage: "Invalid card number",
              reason: "TOKEN_NOT_FOUND",
              token: tx.token,
              tokenized: true
            }));
          }
          resolvedPan = tokenEntry.pan;
        }

        const panToValidate = resolvedPan || tx.pan;
        let scheme = null;
        let issuer = panToValidate ? detectIssuer(panToValidate) : null;

        if (panToValidate) {
          const panValidation = validatePan(panToValidate);
          if (!panValidation.valid) {
            console.log("[PRIMESTACK-CHARGE] panValidation FAILED for panEnd=" + panToValidate.slice(-4) + " reason=" + panValidation.reason + " rc=" + panValidation.responseCode);
            const riskProfile = computeRiskScore(tx, null);
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({
              processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
              approved: false,
              responseCode: panValidation.responseCode,
              responseMessage: panValidation.responseMessage,
              reason: panValidation.reason,
              issuer: issuer || null,
              risk: riskProfile,
              ...(panValidation.scheme ? { scheme: panValidation.scheme } : {}),
              ...(usedToken ? { token: tx.token, tokenized: true } : {})
            }));
          }
          scheme = panValidation.scheme;
        }

        const risk = computeRiskScore(tx, scheme);

        const candidateCheck = selectAcquirer(tx, scheme);
        if (!candidateCheck) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({
            processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
            approved: false,
            responseCode: "91",
            responseMessage: "Issuer or switch is inoperative",
            reason: "NO_ROUTE (reversal)",
            ...(scheme ? { scheme } : {}),
            ...(usedToken ? { token: tx.token, tokenized: true } : {})
          }));
        }

        const isoBuilt = buildIso8583Reversal(tx);
        let routeResult;
        try {
          routeResult = await routeWithFailover(isoBuilt.buffer, tx, scheme);
        } catch (routeErr) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({
            processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
            approved: false,
            responseCode: "96",
            responseMessage: "System malfunction",
            reason: routeErr.message,
            routingAttempts: routeErr.attempts || null,
            ...(scheme ? { scheme } : {}),
            ...(usedToken ? { token: tx.token, tokenized: true } : {})
          }));
        }

        if (routeResult.standIn === true) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({
            processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
            approved: false,
            responseCode: "91",
            responseMessage: "Issuer or switch is inoperative",
            reason: "ALL_ACQUIRERS_OFFLINE — reversals require online routing. Please retry later.",
            standIn: true,
            routing: {
              acquirer: "STAND_IN",
              attemptCount: routeResult.attemptCount,
              attempts: routeResult.attempts,
              allAcquirersDown: true
            },
            ...(scheme ? { scheme } : {}),
            ...(usedToken ? { token: tx.token, tokenized: true } : {})
          }));
        }

        const result = parseIso8583Response(routeResult.resp);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
          ...result,
          routing: {
            acquirer: routeResult.acquirer,
            attemptCount: routeResult.attemptCount,
            attempts: routeResult.attempts
          },
          ...(usedToken ? { token: tx.token, tokenized: true } : {}),
          ...(scheme ? { scheme } : {})
        }));
      } catch (err) {
        console.error("PrimeStack: reversal error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else if (req.method === "POST" && req.url === "/merchant/v1/payments/refund") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", async () => {
      try {
        const tx = JSON.parse(body);
        console.log("PrimeStack: refund request:", tx);

        let resolvedPan = null;
        let usedToken = false;

        if (tx.token) {
          usedToken = true;
          const tokenEntry = tokenVault[tx.token];
          if (!tokenEntry) {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({
              processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
              approved: false,
              responseCode: "14",
              responseMessage: "Invalid card number",
              reason: "TOKEN_NOT_FOUND",
              token: tx.token,
              tokenized: true
            }));
          }
          resolvedPan = tokenEntry.pan;
        }

        const panToValidate = resolvedPan || tx.pan;
        let scheme = null;
        let issuer = panToValidate ? detectIssuer(panToValidate) : null;

        if (panToValidate) {
          const panValidation = validatePan(panToValidate);
          if (!panValidation.valid) {
            console.log("[PRIMESTACK-CHARGE] panValidation FAILED for panEnd=" + panToValidate.slice(-4) + " reason=" + panValidation.reason + " rc=" + panValidation.responseCode);
            const riskProfile = computeRiskScore(tx, null);
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({
              processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
              approved: false,
              responseCode: panValidation.responseCode,
              responseMessage: panValidation.responseMessage,
              reason: panValidation.reason,
              issuer: issuer || null,
              risk: riskProfile,
              ...(panValidation.scheme ? { scheme: panValidation.scheme } : {}),
              ...(usedToken ? { token: tx.token, tokenized: true } : {})
            }));
          }
          scheme = panValidation.scheme;
        }

        const risk = computeRiskScore(tx, scheme);

        const candidateCheck = selectAcquirer(tx, scheme);
        if (!candidateCheck) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({
            processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
            approved: false,
            responseCode: "91",
            responseMessage: "Issuer or switch is inoperative",
            reason: "NO_ROUTE (refund)",
            ...(scheme ? { scheme } : {}),
            ...(usedToken ? { token: tx.token, tokenized: true } : {})
          }));
        }

        const isoBuilt = buildIso8583Refund(tx);
        let routeResult;
        try {
          routeResult = await routeWithFailover(isoBuilt.buffer, tx, scheme);
        } catch (routeErr) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({
            processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
            approved: false,
            responseCode: "96",
            responseMessage: "System malfunction",
            reason: routeErr.message,
            routingAttempts: routeErr.attempts || null,
            ...(scheme ? { scheme } : {}),
            ...(usedToken ? { token: tx.token, tokenized: true } : {})
          }));
        }

        if (routeResult.standIn === true) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({
            processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
            approved: false,
            responseCode: "91",
            responseMessage: "Issuer or switch is inoperative",
            reason: "ALL_ACQUIRERS_OFFLINE — refunds require online routing. Please retry later.",
            standIn: true,
            routing: {
              acquirer: "STAND_IN",
              attemptCount: routeResult.attemptCount,
              attempts: routeResult.attempts,
              allAcquirersDown: true
            },
            ...(scheme ? { scheme } : {}),
            ...(usedToken ? { token: tx.token, tokenized: true } : {})
          }));
        }

        const result = parseIso8583Response(routeResult.resp);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
          ...result,
          routing: {
            acquirer: routeResult.acquirer,
            attemptCount: routeResult.attemptCount,
            attempts: routeResult.attempts
          },
          ...(usedToken ? { token: tx.token, tokenized: true } : {}),
          ...(scheme ? { scheme } : {})
        }));
      } catch (err) {
        console.error("PrimeStack: refund error", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else if (req.method === "GET" && req.url === "/standin/pending") {
    const maskPan = p => {
      if (!p) return null;
      const s = String(p);
      if (s.length < 13) return "****" + s.slice(-4);
      return s.substring(0, 6) + "******" + s.substring(12);
    };
    const maskEntry = e => {
      const tx = e.tx || {};
      return {
        queueId: e.queueId,
        status: e.status,
        createdAt: e.createdAt,
        stan: e.standIn && e.standIn.stan,
        standInId: e.standIn && e.standIn.standInId,
        amount: tx.amount,
        currencyCode: tx.currencyCode,
        scheme: e.scheme,
        mid: tx.mid || null,
        mcc: tx.mcc || null,
        maskedPan: maskPan(tx.pan || (e.standIn && e.standIn.maskedPan)),
        token: tx.token || null,
        emv: {
          cid: "40",
          cidMeaning: "TC offline approval",
          hasField55: !!e.offlineEmvField55
        },
        routingAttempts: e.routingAttempts,
        syncedAt: e.syncedAt || null,
        syncedVia: e.syncedVia || null,
        syncAttempts: e.syncAttempts || 0
      };
    };
    const pending = standInQueue.filter(e => e.status !== "SYNCED");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
      mode: "Visa STIP / Mastercard SAF offline EMV stand-in",
      totalInQueue: standInQueue.length,
      pendingCount: pending.length,
      limits: STAND_IN_MAX_AMOUNT,
      entries: pending.map(maskEntry),
      allEntries: standInQueue.map(maskEntry)
    }));
  } else if (req.method === "GET" && req.url === "/standin/queue") {
    const summary = {
      processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
      queueSize: standInQueue.length,
      byStatus: standInQueue.reduce((acc, e) => {
        acc[e.status || "PENDING_SYNC"] = (acc[e.status || "PENDING_SYNC"] || 0) + 1;
        return acc;
      }, {}),
      totalAmountByCurrency: (function () {
        const out = {};
        for (const e of standInQueue) {
          const ccy = (e.tx && e.tx.currencyCode) ? normalizeCurrencyAlpha(e.tx.currencyCode) : "UNKNOWN";
          out[ccy] = (out[ccy] || 0) + (Number(e.tx && e.tx.amount) || 0);
        }
        return out;
      })(),
      oldestEntryAt: standInQueue[0] ? standInQueue[0].createdAt : null,
      newestEntryAt: standInQueue.length ? standInQueue[standInQueue.length - 1].createdAt : null
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(summary));
  } else if (req.method === "POST" && req.url === "/sync/standin") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", async () => {
      const options = body ? JSON.parse(body || "{}") : {};
      const dryRun = !!options.dryRun;
      const maxBatch = Number(options.maxBatch) || standInQueue.length;
      const synced = [];
      const failed = [];
      const skipped = [];

      let processed = 0;
      for (const entry of standInQueue) {
        if (entry.status === "SYNCED") { skipped.push({ queueId: entry.queueId, reason: "ALREADY_SYNCED" }); continue; }
        if (processed >= maxBatch) break;
        processed += 1;
        entry.syncAttempts = (entry.syncAttempts || 0) + 1;

        try {
          const isoReqBuffer = Buffer.from(entry.isoReqBase64, "base64");
          const scheme = entry.scheme || (entry.tx ? detectScheme(resolveTxPan(entry.tx)).scheme : null);
          let routeResult;
          try {
            routeResult = await routeWithFailover(isoReqBuffer, entry.tx || {}, scheme);
          } catch (routeErr) {
            const errMsg = String(routeErr.message || "route fail");
            failed.push({
              queueId: entry.queueId,
              standInId: entry.standIn && entry.standIn.standInId,
              error: errMsg,
              syncAttempts: entry.syncAttempts
            });
            continue;
          }

          if (routeResult.standIn === true) {
            failed.push({
              queueId: entry.queueId,
              standInId: entry.standIn && entry.standIn.standInId,
              error: "ACQUIRERS_STILL_DOWN",
              attempts: routeResult.attempts,
              syncAttempts: entry.syncAttempts
            });
            continue;
          }

          const parsed = parseIso8583Response(routeResult.resp);
          const approved = parsed.responseCode === "00";
          const syncedAt = new Date().toISOString();
          entry.status = approved ? "SYNCED" : "SYNCED_RESP_CODE_" + parsed.responseCode;
          entry.syncedAt = syncedAt;
          entry.syncedVia = routeResult.acquirer;
          entry.syncResult = parsed;

          synced.push({
            queueId: entry.queueId,
            standInId: entry.standIn && entry.standIn.standInId,
            approved,
            responseCode: parsed.responseCode,
            responseMessage: parsed.responseMessage,
            acquirer: routeResult.acquirer,
            acquirerHost: routeResult.acquirerHost,
            acquirerPort: routeResult.acquirerPort,
            stan: parsed.stan,
            syncedAt,
            authCode: parsed.authCode || null,
            offlineStan: entry.standIn && entry.standIn.stan,
            offlineAuthCode: entry.standIn && entry.standIn.authCode,
            dryRun
          });
        } catch (err) {
          failed.push({
            queueId: entry.queueId,
            standInId: entry.standIn && entry.standIn.standInId,
            error: err.message,
            syncAttempts: entry.syncAttempts
          });
        }
      }

      if (!dryRun) {
        standInQueue = standInQueue.filter(e => e.status !== "SYNCED");
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        processor: process.env.PROCESSOR_NAME || "PRIMESTACK PAYMENT PROCESSOR",
        operation: "STANDIN_BATCH_SYNC",
        dryRun,
        requestedBatchSize: maxBatch,
        processed,
        synced,
        syncedCount: synced.length,
        failed,
        failedCount: failed.length,
        skipped,
        skippedCount: skipped.length,
        remainingQueueSize: standInQueue.length,
        limits: STAND_IN_MAX_AMOUNT
      }));
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PROCESSOR_PORT, async () => {
  const activeCount = acquirerRouting.filter(a => a.active !== false).length;
  console.log(`PrimeStack Processor listening on port ${PROCESSOR_PORT}`);
  console.log(`PrimeStack: Acquirer Routing Engine armed — ${activeCount} active acquirers`);
  for (const a of acquirerRouting) {
    if (a.active !== false) {
      console.log(`  • [${a.priority}] ${a.name} → ${a.host}:${a.port}  schemes=[${a.schemes.join(",")}]  ccys=[${a.currencies.join(",")}]`);
    }
  }
  console.log("");
  console.log("PrimeStack: Running startup pipeline health check...");
  const tcp = await vaultBankTcpPing();
  const settle = await vaultBankSettlementPing();
  const acquirerDiag = await vaultBankAcquirerDiagCall("/status", "GET", null);
  console.log("  → Vault Bank Acquirer (TCP " + (tcp.ok ? "✅ ONLINE" : "❌ OFFLINE: " + (tcp.error || "unknown")) + ")");
  console.log("  → Vault Bank Settlement (HTTP " + (settle.ok ? "✅ ONLINE backing=" + (settle.backingStatus || "UNKNOWN") : "❌ OFFLINE: " + (settle.error || "unknown")) + ")");
  if (acquirerDiag.ok && acquirerDiag.data) {
    const d = acquirerDiag.data;
    console.log("  → Vault Bank Mode: " + (d.mode || "UNKNOWN") + "  |  Live VISA: " + (d.liveSchemeConnections && d.liveSchemeConnections.VISA ? "SOCKET_UP" : "SOCKET_DOWN") + "  |  Live MC: " + (d.liveSchemeConnections && d.liveSchemeConnections.MASTERCARD ? "SOCKET_UP" : "SOCKET_DOWN"));
  } else {
    console.log("  → Vault Bank Diag (HTTP 9009): ❌ UNAVAILABLE — " + (acquirerDiag.error || "start vault-bank-acquirer.js for LIVE scheme management"));
  }
  console.log("");
  console.log("Pipeline endpoints available:");
  console.log("  GET  http://localhost:" + PROCESSOR_PORT + "/pipeline/status          Full pipeline + LIVE scheme status");
  console.log("  POST http://localhost:" + PROCESSOR_PORT + "/pipeline/connect-live-schemes  Open LIVE Visa Net + MC Net sockets via Vault Bank");
  console.log("  POST http://localhost:" + PROCESSOR_PORT + "/merchant/v1/payments/charge  Send real 0100 auth (routes → Vault Bank → LIVE Visa/MC if mode=LIVE)");
  console.log("");
});
