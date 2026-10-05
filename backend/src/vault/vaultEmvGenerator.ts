// vaultEmvGenerator.ts — EMV Field 55 generator for vault cards
import crypto from "crypto";

function tlv(tag: string, value: Buffer): string {
  return tag + value.length.toString(16).padStart(2, "0").toUpperCase() + value.toString("hex").toUpperCase();
}

export function generateVaultField55(
  card: { pan: string; expiry: string; atc: number },
  amountMinor: number,
  currencyCode: string   // e.g. "0840" for USD, "0978" for EUR
): string {
  const un  = crypto.randomBytes(4);                  // 9F37 unpredictable number
  const tvr = Buffer.from("0000000000", "hex");       // 95  terminal verification results
  const tsi = Buffer.from("0000", "hex");             // 9B  transaction status information
  const aip = Buffer.from("3800", "hex");             // 82  application interchange profile
  const iad = Buffer.concat([
    Buffer.from("07", "hex"),                          // IAD format version
    crypto.randomBytes(7),                             // issuer discretionary data
  ]);

  // ARQC: SHA-256 of PAN + ATC + amount + currency + UN, first 8 bytes
  const atcBuf = Buffer.from([card.atc >> 8, card.atc & 0xff]);
  const arqc = crypto.createHash("sha256")
    .update(card.pan)
    .update(atcBuf)
    .update(Buffer.from(String(amountMinor)))
    .update(Buffer.from(currencyCode))
    .update(un)
    .digest()
    .subarray(0, 8);

  // PAN as BCD hex
  const panHex = Buffer.from(card.pan + (card.pan.length % 2 ? "F" : ""), "hex");

  // Expiry: YYMMDD packed BCD — 9F24 format YYMM
  const expParts = card.expiry.split("/"); // MM/YY
  const expiryHex = Buffer.from(expParts[1] + expParts[0], "hex"); // YYMM

  // Amount: 6-byte BCD
  const amtBuf = Buffer.from(amountMinor.toString().padStart(12, "0"), "hex");

  // Currency: 2-byte hex
  const ccyBuf = Buffer.from(currencyCode.padStart(4, "0"), "hex");

  const field55 =
    tlv("5A",   panHex)         +  // PAN
    tlv("5F24", expiryHex)      +  // Expiry date
    tlv("9F10", iad)             +  // Issuer application data
    tlv("9F26", arqc)            +  // ARQC
    tlv("9F27", Buffer.from("80", "hex")) +  // Cryptogram type (ARQC)
    tlv("9F36", atcBuf)          +  // ATC
    tlv("9F37", un)              +  // Unpredictable number
    tlv("95",   tvr)             +  // TVR
    tlv("9B",   tsi)             +  // TSI
    tlv("82",   aip)             +  // AIP
    tlv("9F02", amtBuf)          +  // Amount authorized
    tlv("5F2A", ccyBuf);           // Transaction currency

  return field55;
}