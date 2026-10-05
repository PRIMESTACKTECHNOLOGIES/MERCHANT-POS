import { EmvData } from "./emvValidation";
import { SoftwareEmvIssuerCrypto } from "./issuerCrypto";

function buildCdol1(emv: EmvData): string {
  return Buffer.concat([
    emv.amount!,
    Buffer.alloc(6),
    emv.terminalCountry || Buffer.from("0840", "hex"),
    emv.tvr || Buffer.alloc(5),
    emv.currency!,
    emv.transactionDate || Buffer.from("000000", "hex"),
    emv.transactionType || Buffer.from("00", "hex"),
    emv.unpredictableNumber!,
    emv.atc!,
    emv.iad || Buffer.alloc(8),
  ]).toString("hex");
}

export function validateArqc(
  emv: EmvData,
  amountMinor: number,
  currencyCode: string,
): boolean {
  if (!emv.arqc || emv.arqc.length !== 8 || !emv.atc || !emv.unpredictableNumber || !emv.amount || !emv.currency || !Number.isSafeInteger(amountMinor)) {
    return false;
  }
  const configured = process.env.EMV_ISSUER_MASTER_KEY_HEX;
  if (!configured) return true;
  try {
    const cdol1 = buildCdol1(emv);
    SoftwareEmvIssuerCrypto.fromEnvironment().validate({
      pan: emv.pan || "",
      atc: emv.atc.toString("hex"),
      cdol1Hex: cdol1,
      arqc: emv.arqc.toString("hex"),
    });
    return String(currencyCode || "").length === 3;
  } catch {
    return false;
  }
}

export function generateArpc(
  emv: EmvData,
  pan: string,
  responseCode = "00",
): string | null {
  if (!process.env.EMV_ISSUER_MASTER_KEY_HEX || !emv.arqc || !emv.atc) return null;
  const crypto = SoftwareEmvIssuerCrypto.fromEnvironment();
  return crypto.generateArpc({
    pan,
    atc: emv.atc.toString("hex"),
    cdol1Hex: buildCdol1(emv),
    arqc: emv.arqc.toString("hex"),
    responseCode,
  });
}
