import { EmvData } from "./emvValidation";
import { SoftwareEmvIssuerCrypto } from "./issuerCrypto";
import { CDOL1_HEX, buildDolData } from "./emvCdol";

/**
 * Rebuild the CDOL1 byte string that the card MAC'd for this transaction.
 *
 * The DOL order is normative (see emvCdol.ts) — the issuer must produce the
 * exact bytes the terminal sent inside GENERATE AC, so the values are mapped
 * onto the published DOL rather than concatenated by hand.
 */
function buildCdol1(emv: EmvData): string {
  return buildDolData(CDOL1_HEX, {
    "9F02": emv.amount?.toString("hex"),
    "9F03": "000000000000",
    "9F1A": emv.terminalCountry?.toString("hex") || "0840",
    "95": emv.tvr?.toString("hex") || "0000000000",
    "5F2A": emv.currency?.toString("hex"),
    "9A": emv.transactionDate?.toString("hex") || "000000",
    "9C": emv.transactionType?.toString("hex") || "00",
    "9F37": emv.unpredictableNumber?.toString("hex"),
    "9F36": emv.atc?.toString("hex"),
    "9F10": emv.iad?.toString("hex") || "0000000000000000",
  });
}

/** True when an issuer master key is available to prove a cryptogram. */
export function issuerKeyConfigured(): boolean {
  return Boolean(process.env.EMV_ISSUER_MASTER_KEY_HEX);
}

export function validateArqc(
  emv: EmvData,
  amountMinor: number,
  currencyCode: string,
): boolean {
  if (!emv.arqc || emv.arqc.length !== 8 || !emv.atc || !emv.unpredictableNumber || !emv.amount || !emv.currency || !Number.isSafeInteger(amountMinor)) {
    return false;
  }

  // FAIL CLOSED. Without the issuer master key there is no way to prove the
  // cryptogram came from the card, and approving here would fabricate an
  // approval ("phantom approval") for a card nothing verified. Decline instead.
  if (!issuerKeyConfigured()) {
    console.error(
      "[EMV] EMV_ISSUER_MASTER_KEY_HEX is not configured — ARQC cannot be validated. " +
      "Declining the transaction (fail-closed). Set the issuer master key to enable EMV authorization.",
    );
    return false;
  }

  try {
    const cdol1 = buildCdol1(emv);
    SoftwareEmvIssuerCrypto.fromEnvironment().validate({
      pan: emv.pan || "",
      atc: emv.atc.toString("hex"),
      cdol1Hex: cdol1,
      arqc: emv.arqc.toString("hex"),
    });
    return String(currencyCode || "").length === 3;
  } catch (err: any) {
    console.warn("[EMV] ARQC validation failed: " + (err?.message || err));
    return false;
  }
}

/**
 * Generate the ARPC the card uses to authenticate the issuer.
 * Returns null — never a fabricated value — when the issuer key is missing.
 */
export function generateArpc(
  emv: EmvData,
  pan: string,
  responseCode = "00",
): string | null {
  if (!issuerKeyConfigured() || !emv.arqc || !emv.atc) return null;
  const crypto = SoftwareEmvIssuerCrypto.fromEnvironment();
  return crypto.generateArpc({
    pan,
    atc: emv.atc.toString("hex"),
    cdol1Hex: buildCdol1(emv),
    arqc: emv.arqc.toString("hex"),
    responseCode,
  });
}
