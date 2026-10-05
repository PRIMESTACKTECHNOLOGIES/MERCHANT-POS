// vaultBin.ts — Vault Bank BIN configuration
// Replace bin with your real BIN once assigned by Visa/Mastercard BIN sponsor

export const VAULT_BIN = {
  bin:     "416598",   // PROC-VAULT-USD-002 BIN (Visa debit range)
  scheme:  "VISA",
  product: "DEBIT",
  country: "AE",
};

export const VAULT_BIN_EUR = {
  bin:     "453201",   // PROC-VAULT-EUR-001 BIN (Visa debit range)
  scheme:  "VISA",
  product: "DEBIT",
  country: "AE",
};