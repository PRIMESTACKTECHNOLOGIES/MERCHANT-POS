// luhn.ts — Luhn-valid PAN generator

export function luhnCheckDigit(partial: string): number {
  let sum = 0;
  let double = true;
  for (let i = partial.length - 1; i >= 0; i--) {
    let digit = parseInt(partial[i], 10);
    if (double) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

export function generateVaultPan(bin: string): string {
  let body = bin;
  for (let i = 0; i < 9; i++) body += Math.floor(Math.random() * 10).toString();
  return body + luhnCheckDigit(body).toString();
}

export function generateExpiry(): string {
  const now = new Date();
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0");
  const year  = String((now.getFullYear() + 5) % 100).padStart(2, "0");
  return `${month}/${year}`;
}

export function generateCvv(pan: string, expiry: string): string {
  const crypto = require("crypto");
  const hash = crypto.createHash("sha256").update(pan + expiry).digest("hex");
  return (parseInt(hash.slice(0, 8), 16) % 900 + 100).toString();
}