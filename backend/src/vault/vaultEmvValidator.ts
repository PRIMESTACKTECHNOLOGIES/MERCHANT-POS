// vaultEmvValidator.ts — Issuer-side EMV cryptogram validation for vault cards.
//
// The ARQC is validated with the same 3DES key schedule the card used:
//   IMK → UDK (PAN ‖ PSN) → session key (ATC) → ISO 9797-1 Alg 3 retail MAC
// See issuer/issuerCrypto.ts. The previous SHA-256 comparison was not a
// cryptographic proof — it only proved the caller knew the same secret input,
// which anyone holding the PAN could reproduce.

import { parseEmvField55 } from '../services/hsm/emvField55Parser';
import { SoftwareEmvIssuerCrypto } from '../issuer/issuerCrypto';
import {
  cdol1FromField55,
  decodeBcdAmount,
} from '../issuer/emvCdol';

export interface VaultEmvResult {
  valid: boolean;
  reason?: string;
  /** Cryptogram the card presented (9F26). */
  arqcHex?: string;
  atc?: number;
  atcHex?: string;
  /** The exact CDOL1 byte string the card MAC'd. Reused to derive the ARPC so
   *  both cryptograms are bound to the same transaction data. */
  cdol1Hex?: string;
}

function hexOf(value?: Buffer): string | undefined {
  return value ? value.toString('hex').toUpperCase() : undefined;
}

/**
 * Validate the EMV Field 55 block presented for a vault card.
 *
 * @param field55Hex  DE55 TLV block from the terminal.
 * @param card        PAN and PAN sequence number from the card record.
 * @param amountMinor Authorized amount in minor units (ISO 8583 DE4).
 * @param currencyBcd 2-byte BCD currency as it appears in tag 5F2A ("0840").
 */
export function validateVaultEmv(
  field55Hex: string,
  card: { pan: string; panSequence?: string },
  amountMinor: number,
  currencyBcd: string,
): VaultEmvResult {
  let tags: ReturnType<typeof parseEmvField55>;
  try {
    tags = parseEmvField55(String(field55Hex || ''));
  } catch {
    return { valid: false, reason: 'EMV_PARSE_ERROR' };
  }
  if (!tags || Object.keys(tags).length === 0) {
    return { valid: false, reason: 'EMV_FIELD55_EMPTY' };
  }

  const arqcHex = hexOf(tags.arqc);
  if (!arqcHex || arqcHex.length !== 16) return { valid: false, reason: 'EMV_ARQC_INVALID_LENGTH' };
  if (!tags.atc || tags.atc.length !== 2) return { valid: false, reason: 'EMV_ATC_MISSING' };
  if (!tags.unpredictableNumber || tags.unpredictableNumber.length !== 4) {
    return { valid: false, reason: 'EMV_UNPREDICTABLE_NUMBER_MISSING' };
  }
  if (!tags.amount || tags.amount.length !== 6) return { valid: false, reason: 'EMV_AMOUNT_MISSING' };
  if (!tags.currency || tags.currency.length !== 2) return { valid: false, reason: 'EMV_CURRENCY_MISSING' };
  if (!tags.iad) return { valid: false, reason: 'EMV_IAD_MISSING' };
  if (!tags.tvr || tags.tvr.length !== 5) return { valid: false, reason: 'EMV_TVR_MISSING' };
  if (!tags.txnDate || tags.txnDate.length !== 3) return { valid: false, reason: 'EMV_TXN_DATE_MISSING' };
  if (!tags.txnType || tags.txnType.length !== 1) return { valid: false, reason: 'EMV_TXN_TYPE_MISSING' };

  // The amount inside the cryptogram must be the amount being authorized.
  let cryptogramAmount: number;
  try {
    cryptogramAmount = decodeBcdAmount(hexOf(tags.amount)!);
  } catch {
    return { valid: false, reason: 'EMV_AMOUNT_NOT_BCD' };
  }
  if (cryptogramAmount !== amountMinor) {
    return { valid: false, reason: 'EMV_AMOUNT_MISMATCH' };
  }

  const presentedCurrency = hexOf(tags.currency)!;
  if (presentedCurrency !== currencyBcd.toUpperCase()) {
    return { valid: false, reason: 'EMV_CURRENCY_MISMATCH' };
  }

  // Rebuild the exact CDOL1 byte string the card MAC'd (shared mapping).
  const { cdol1Hex, missing } = cdol1FromField55(tags);
  if (missing.length) {
    return { valid: false, reason: `EMV_CDOL1_TAG_MISSING:${missing.join(',')}` };
  }

  if (!process.env.EMV_ISSUER_MASTER_KEY_HEX) {
    // Fail closed: without the issuer master key no cryptogram can be proven.
    return { valid: false, reason: 'EMV_ISSUER_KEY_NOT_CONFIGURED' };
  }

  try {
    SoftwareEmvIssuerCrypto.fromEnvironment().validate({
      pan: card.pan,
      panSequence: card.panSequence,
      atc: hexOf(tags.atc)!,
      cdol1Hex,
      arqc: arqcHex,
    });
  } catch (err: any) {
    return {
      valid: false,
      reason: err?.message === 'EMV_ARQC_INVALID' ? 'EMV_CRYPTOGRAM_INVALID' : `EMV_CRYPTO_ERROR:${err?.message || err}`,
    };
  }

  return {
    valid: true,
    arqcHex,
    atc: (tags.atc[0] << 8) | tags.atc[1],
    atcHex: hexOf(tags.atc),
    cdol1Hex,
  };
}
