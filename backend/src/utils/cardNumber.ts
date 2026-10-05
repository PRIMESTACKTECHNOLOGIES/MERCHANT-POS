import crypto from "crypto";
import { BIN_RANGES, BinRange } from "../config/bin";

function luhnCheckDigit(partial: string): number {
  let sum = 0;
  let shouldDouble = true;

  for (let i = partial.length - 1; i >= 0; i -= 1) {
    let digit = Number(partial[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return (10 - (sum % 10)) % 10;
}

export function generateCardNumberFromBin(bin: string): string {
  if (!/^\d{6}$/.test(bin)) {
    throw new Error("BIN must be 6 digits");
  }

  let body = bin;
  for (let i = 0; i < 9; i += 1) {
    body += crypto.randomInt(0, 10).toString();
  }

  return body + luhnCheckDigit(body).toString();
}

export function pickBin(): BinRange {
  return BIN_RANGES[Math.floor(Math.random() * BIN_RANGES.length)];
}
