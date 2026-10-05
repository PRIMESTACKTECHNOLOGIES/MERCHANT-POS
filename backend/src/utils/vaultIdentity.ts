import crypto from 'crypto';

function randomDigits(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += crypto.randomInt(0, 10).toString();
  }
  return out;
}

function lettersToNumbers(input: string): string {
  let out = '';
  for (const ch of input.toUpperCase()) {
    if (ch >= 'A' && ch <= 'Z') {
      out += (ch.charCodeAt(0) - 55).toString();
    } else if (ch >= '0' && ch <= '9') {
      out += ch;
    }
  }
  return out;
}

function mod97(numeric: string): number {
  let remainder = 0;
  for (const digit of numeric) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

/**
 * Generates an internal PrimeStack identifier.
 *
 * These values are for internal display and routing metadata only. They are
 * not bank-issued account numbers, ABA routing numbers, SWIFT/BIC codes, or
 * usable IBANs.
 */
export function generateVaultAccountNumber(regionCode = 'DXB'): string {
  const region = regionCode.trim().toUpperCase();
  if (!/^[A-Z]{2,8}$/.test(region)) {
    throw new Error('regionCode must contain 2-8 letters');
  }
  return `PS-${region}-VLT-${randomDigits(8)}`;
}

/**
 * Internal routing identifier with a simple checksum.
 * This is not a real ABA routing number.
 */
export function generateRoutingNumber(): string {
  const base = randomDigits(8);
  const checksum = base
    .split('')
    .reduce((sum, digit) => sum + Number(digit), 0) % 10;
  return `${base}${checksum}`;
}

/**
 * Internal SWIFT/BIC-like identifier.
 * This is not a bank-issued SWIFT/BIC code.
 */
export function generateSwiftBic(
  countryCode = 'AE',
  cityCode = 'DX',
  branchCode = '001',
): string {
  const country = countryCode.trim().toUpperCase();
  const city = cityCode.trim().toUpperCase();
  const branch = branchCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z]{2}$/.test(city) || !/^[A-Z0-9]{3}$/.test(branch)) {
    throw new Error('Invalid internal SWIFT/BIC components');
  }
  return `PRST${country}${city}${branch}`;
}

/**
 * Generates an internal IBAN-shaped value with valid MOD-97 check digits.
 * This is not a bank-issued IBAN and must not be sent to a bank.
 */
export function generateIban(
  countryCode = 'AE',
  bankCode = 'PRST',
  branchCode = '0001',
): string {
  const country = countryCode.trim().toUpperCase();
  const bank = bankCode.trim().toUpperCase();
  const branch = branchCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z0-9]{4}$/.test(bank) || !/^[A-Z0-9]{4}$/.test(branch)) {
    throw new Error('Invalid internal IBAN components');
  }

  const bban = `${bank}${branch}${randomDigits(8)}`;
  const checkDigits = String(98 - mod97(lettersToNumbers(`${bban}${country}00`))).padStart(2, '0');
  return `${country}${checkDigits}${bban}`;
}

export interface VaultIdentity {
  vaultAccount: string;
  routing: string;
  swift: string;
  iban: string;
  internalOnly: true;
}

export function generateVaultIdentity(regionCode = 'DXB'): VaultIdentity {
  return {
    vaultAccount: generateVaultAccountNumber(regionCode),
    routing: generateRoutingNumber(),
    swift: generateSwiftBic(),
    iban: generateIban(),
    internalOnly: true,
  };
}
