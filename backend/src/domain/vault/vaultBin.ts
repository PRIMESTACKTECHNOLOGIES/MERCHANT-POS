export const VAULT_BIN = {
  bin: "412345",
  scheme: "VISA",
  product: "DEBIT",
  country: "AE",
};

export interface VaultBinInfo {
  bin: string;
  scheme: string;
  product: string;
  country: string;
}

export const VAULT_BINS: Record<string, VaultBinInfo> = {
  "PROC-VAULT-USD-002": {
    bin: "412345",
    scheme: "VISA",
    product: "DEBIT",
    country: "US",
  },
  "PROC-VAULT-EUR-001": {
    bin: "423456",
    scheme: "VISA",
    product: "DEBIT",
    country: "BE",
  },
  "VAULT-WISE-EUR-001": {
    bin: "532345",
    scheme: "MASTERCARD",
    product: "DEBIT",
    country: "DE",
  },
};

export function getVaultBin(vaultAccountId: string): VaultBinInfo {
  const bin = VAULT_BINS[vaultAccountId];
  if (bin) return bin;
  return VAULT_BIN;
}
