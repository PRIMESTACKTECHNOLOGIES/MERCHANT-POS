import crypto from "crypto";

export type CardScheme = "VISA" | "MASTERCARD";

export interface GeneratedCard {
  scheme: CardScheme;
  card_number: string;
  bin: string;
  last4: string;
  expiry_month: string;
  expiry_year: string;
  expiry: string;
  cvv: string;
}

export const VISA_BIN_RANGES: string[] = [
  "400000",
  "400001",
  "411111",
  "422222",
  "424242",
  "424303",
  "431951",
  "450875",
  "453201",
  "453242",
  "453948",
  "455636",
  "471688",
  "491633",
  "491649",
  "491699",
  "492989",
  "453241",
  "448522",
  "471677",
];

export const MASTERCARD_BIN_RANGES: string[] = [
  "510000",
  "510510",
  "511000",
  "515000",
  "520000",
  "520082",
  "521000",
  "525000",
  "530000",
  "531000",
  "535000",
  "540000",
  "541000",
  "545000",
  "550000",
  "551000",
  "555000",
  "557700",
  "222100",
  "222300",
  "222500",
  "222700",
  "222900",
  "223000",
  "223200",
  "223400",
  "223600",
  "223800",
  "224000",
  "224200",
  "224400",
  "224600",
  "224800",
  "225000",
  "225200",
  "225400",
  "225600",
  "225800",
  "226000",
  "226200",
  "226400",
  "226600",
  "226800",
  "227000",
  "227200",
  "227400",
  "227600",
  "227800",
  "228000",
  "228200",
  "228400",
  "228600",
  "228800",
  "229000",
  "229200",
  "229400",
  "229600",
  "229800",
  "230000",
  "230200",
  "230400",
  "230600",
  "230800",
  "231000",
  "231200",
  "231400",
  "231600",
  "231800",
  "232000",
  "232200",
  "232400",
  "232600",
  "232800",
  "233000",
  "233200",
  "233400",
  "233600",
  "233800",
  "234000",
  "234200",
  "234400",
  "234600",
  "234800",
  "235000",
  "235200",
  "235400",
  "235600",
  "235800",
  "236000",
  "236200",
  "236400",
  "236600",
  "236800",
  "237000",
  "237200",
  "237400",
  "237600",
  "237800",
  "238000",
  "238200",
  "238400",
  "238600",
  "238800",
  "239000",
  "239200",
  "239400",
  "239600",
  "239800",
  "240000",
  "240200",
  "240400",
  "240600",
  "240800",
  "241000",
  "241200",
  "241400",
  "241600",
  "241800",
  "242000",
  "242200",
  "242400",
  "242600",
  "242800",
  "243000",
  "243200",
  "243400",
  "243600",
  "243800",
  "244000",
  "244200",
  "244400",
  "244600",
  "244800",
  "245000",
  "245200",
  "245400",
  "245600",
  "245800",
  "246000",
  "246200",
  "246400",
  "246600",
  "246800",
  "247000",
  "247200",
  "247400",
  "247600",
  "247800",
  "248000",
  "248200",
  "248400",
  "248600",
  "248800",
  "249000",
  "249200",
  "249400",
  "249600",
  "249800",
  "250000",
  "250200",
  "250400",
  "250600",
  "250800",
  "251000",
  "251200",
  "251400",
  "251600",
  "251800",
  "252000",
  "252200",
  "252400",
  "252600",
  "252800",
  "253000",
  "253200",
  "253400",
  "253600",
  "253800",
  "254000",
  "254200",
  "254400",
  "254600",
  "254800",
  "255000",
  "255200",
  "255400",
  "255600",
  "255800",
  "256000",
  "256200",
  "256400",
  "256600",
  "256800",
  "257000",
  "257200",
  "257400",
  "257600",
  "257800",
  "258000",
  "258200",
  "258400",
  "258600",
  "258800",
  "259000",
  "259200",
  "259400",
  "259600",
  "259800",
  "260000",
  "260200",
  "260400",
  "260600",
  "260800",
  "261000",
  "261200",
  "261400",
  "261600",
  "261800",
  "262000",
  "262200",
  "262400",
  "262600",
  "262800",
  "263000",
  "263200",
  "263400",
  "263600",
  "263800",
  "264000",
  "264200",
  "264400",
  "264600",
  "264800",
  "265000",
  "265200",
  "265400",
  "265600",
  "265800",
  "266000",
  "266200",
  "266400",
  "266600",
  "266800",
  "267000",
  "267200",
  "267400",
  "267600",
  "267800",
  "268000",
  "268200",
  "268400",
  "268600",
  "268800",
  "269000",
  "269200",
  "269400",
  "269600",
  "269800",
  "270000",
  "270200",
  "270400",
  "270600",
  "270800",
  "271000",
  "271200",
  "271400",
  "271600",
  "271800",
  "272000",
  "500000",
  "510000",
  "511000",
  "515000",
  "520000",
  "525000",
  "530000",
  "535000",
  "540000",
  "545000",
  "550000",
  "555000",
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(crypto.randomInt(0, arr.length))];
}

export function computeLuhnCheckDigit(panWithoutCheck: string): string {
  let sum = 0;
  let shouldDouble = true;
  for (let i = panWithoutCheck.length - 1; i >= 0; i--) {
    let digit = parseInt(panWithoutCheck[i], 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit.toString();
}

export function validateLuhn(pan: string): boolean {
  if (!/^\d{13,19}$/.test(pan)) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = pan.length - 1; i >= 0; i--) {
    let digit = parseInt(pan[i], 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

export function generateCardNumber(scheme: CardScheme = "VISA"): string {
  const binList = scheme === "VISA" ? VISA_BIN_RANGES : MASTERCARD_BIN_RANGES;
  const bin = pickRandom(binList);
  const digitsToGenerate = scheme === "VISA" ? 9 : 9;
  let middle = "";
  for (let i = 0; i < digitsToGenerate; i++) {
    middle += crypto.randomInt(0, 10).toString();
  }
  const panWithoutCheck = bin + middle;
  const checkDigit = computeLuhnCheckDigit(panWithoutCheck);
  return panWithoutCheck + checkDigit;
}

export function generateExpiry(validityYears: number = 3): {
  expiry_month: string;
  expiry_year: string;
  expiry: string;
} {
  const now = new Date();
  const month = String(crypto.randomInt(1, 13)).padStart(2, "0");
  const yearFull = now.getFullYear() + validityYears;
  const year = String(yearFull % 100).padStart(2, "0");
  return {
    expiry_month: month,
    expiry_year: year,
    expiry: `${month}/${year}`,
  };
}

export function generateCVV(pan?: string, expiryYY?: string): string {
  if (pan && expiryYY) {
    const seed = `${pan}${expiryYY}`;
    const hash = crypto.createHash("sha256").update(seed).digest("hex");
    const value = parseInt(hash.slice(0, 8), 16) % 900 + 100;
    return value.toString();
  }
  return (crypto.randomInt(100, 1000)).toString();
}

export function generateVirtualCard(
  scheme: CardScheme = "VISA",
  validityYears: number = 3
): GeneratedCard {
  const card_number = generateCardNumber(scheme);
  const bin = card_number.slice(0, 6);
  const last4 = card_number.slice(-4);
  const { expiry_month, expiry_year, expiry } = generateExpiry(validityYears);
  const cvv = generateCVV(card_number, expiry_year);
  return {
    scheme,
    card_number,
    bin,
    last4,
    expiry_month,
    expiry_year,
    expiry,
    cvv,
  };
}

export function formatCardNumber(card_number: string): string {
  return card_number.replace(/(\d{4})(?=\d)/g, "$1 ");
}

const PAN_ENCRYPTION_KEY_ID = process.env.PAN_ENCRYPTION_KID || "local-dev-kid-001";
const PAN_ENCRYPTION_SECRET =
  process.env.PAN_ENCRYPTION_SECRET || "pos-2013-local-pan-encryption-key-change-in-prod-32byte";

function getPanKey(): Buffer {
  const hash = crypto.createHash("sha256").update(PAN_ENCRYPTION_SECRET).digest();
  return hash.slice(0, 32);
}

export function encryptPan(plainPan: string, keyId: string = PAN_ENCRYPTION_KEY_ID): {
  encrypted: string;
  kid: string;
} {
  const key = getPanKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const aad = Buffer.from(`kid=${keyId};ts=${Date.now()}`);
  cipher.setAAD(aad);
  const enc = Buffer.concat([
    cipher.update(Buffer.from(plainPan, "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, tag, enc]).toString("base64");
  return {
    encrypted: `${keyId}.${combined}`,
    kid: keyId,
  };
}

export function decryptPan(encryptedBlob: string): string {
  const [kidPart, ...rest] = encryptedBlob.split(".");
  const encoded = rest.join(".");
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const enc = buf.slice(28);
  const key = getPanKey();
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    const aad = Buffer.from(`kid=${kidPart}`);
    try {
      decipher.setAAD(aad);
    } catch (_) { /* older blobs may not support exact AAD; continue with best-effort */ }
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
    return plain.toString("utf8");
  } catch (err: any) {
    console.error('[virtualCard] decryptPan failed (key mismatch or corrupt blob):', err.message);
    return '****-****-****-0000';
  }
}

export function detectSchemeFromPan(pan: string): CardScheme | null {
  const clean = pan.replace(/\D/g, "");
  if (/^4/.test(clean)) return "VISA";
  if (/^(5[1-5]|2[2-7])/.test(clean)) return "MASTERCARD";
  return null;
}
