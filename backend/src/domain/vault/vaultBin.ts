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
};

export function getVaultBin(vaultAccountId: string): VaultBinInfo {
  const bin = VAULT_BINS[vaultAccountId];
  if (bin) return bin;
  return VAULT_BIN;
}

/**
 * True when a PAN belongs to a card Primestack itself issues.
 *
 * This distinction decides who validates the ARQC: Primestack holds only the
 * vault issuer master key, so it can validate its own cards' cryptograms — an
 * external customer card's cryptogram can only be validated by *its* issuer
 * (i.e. by the acquirer/scheme). Running the local validator on an external
 * PAN would fail a genuine tap.
 */
export function isVaultBin(pan: string): boolean {
  const clean = String(pan || '').replace(/\D/g, '');
  if (clean.length < 6) return false;
  return Object.values(VAULT_BINS).some(b => clean.startsWith(b.bin));
}
