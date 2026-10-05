export interface BinRange {
  bin: string;
  scheme: "VISA" | "MASTERCARD";
  product: "DEBIT" | "CREDIT" | "PREPAID";
  country: string;
}

export const BIN_RANGES: BinRange[] = [
  { bin: "412345", scheme: "VISA", product: "DEBIT", country: "AE" },
  { bin: "423456", scheme: "VISA", product: "PREPAID", country: "AE" },
  { bin: "532345", scheme: "MASTERCARD", product: "DEBIT", country: "AE" },
];
