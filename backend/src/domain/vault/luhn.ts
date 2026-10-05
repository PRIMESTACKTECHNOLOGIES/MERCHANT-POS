export function luhnCheckDigit(partial: string): number {
  let sum = 0;
  let double = true;

  for (let i = partial.length - 1; i >= 0; i--) {
    let digit = parseInt(partial[i], 10);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }

  return (10 - (sum % 10)) % 10;
}

export function luhnValidate(pan: string): boolean {
  if (!pan || !/^\d+$/.test(pan)) return false;
  const digits = pan.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  const body = digits.slice(0, -1);
  const expectedCheck = parseInt(digits.slice(-1), 10);
  return luhnCheckDigit(body) === expectedCheck;
}

export function generateVaultPan(bin: string): string {
  let body = bin;
  for (let i = 0; i < 9; i++) {
    body += Math.floor(Math.random() * 10).toString();
  }
  const checkDigit = luhnCheckDigit(body);
  return body + checkDigit.toString();
}

export function generatePan(bin: string): string {
  return generateVaultPan(bin);
}

export function generateExpiry(): string {
  const now = new Date();
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0");
  const year = String((now.getFullYear() + 5) % 100).padStart(2, "0");
  return `${month}/${year}`;
}

export function generateCvv(): string {
  return String(Math.floor(100 + Math.random() * 900));
}
