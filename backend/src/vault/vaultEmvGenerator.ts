// vaultEmvGenerator.ts — EMV Field 55 (DE55) builder for vault cards.
//
// This is the processor's *software card*: it plays the card side of the EMV
// exchange for cards that are not physically present (web checkout, back-office
// simulation, regression tests). It therefore has to produce a real cryptogram
// with the same key schedule a chip card would use — see issuer/issuerCrypto.ts.
//
// The Android HCE applet (VirtualCardHceService) implements the same profile in
// Kotlin for contactless taps. Any change to the tags or the CDOL here must be
// mirrored there; the DOL definitions live in issuer/emvCdol.ts.

import crypto from 'crypto';
import { SoftwareEmvIssuerCrypto } from '../issuer/issuerCrypto';
import {
  AIP_HEX,
  AFL_HEX,
  CDOL1_HEX,
  buildDolData,
  encodeBcdAmount,
  currencyToBcd,
} from '../issuer/emvCdol';

function tlv(tag: string, value: Buffer): string {
  if (value.length > 0xff) {
    return tag + '81' + value.length.toString(16).padStart(2, '0').toUpperCase() + value.toString('hex').toUpperCase();
  }
  return tag + value.length.toString(16).padStart(2, '0').toUpperCase() + value.toString('hex').toUpperCase();
}

function hexToBuffer(hex: string): Buffer {
  return Buffer.from(String(hex).replace(/\s+/g, '').toUpperCase(), 'hex');
}

/** "MM/YY" → 3-byte BCD n6 expiry "YYMMDD". */
function expiryToBcd(expiry: string): Buffer {
  const match = /^(\d{2})\/(\d{2})$/.exec(String(expiry || '').trim());
  if (!match) throw new Error('VAULT_CARD_EXPIRY_INVALID');
  const [, mm, yy] = match;
  const month = Number(mm);
  if (month < 1 || month > 12) throw new Error('VAULT_CARD_EXPIRY_INVALID');
  const lastDay = new Date(2000 + Number(yy), month, 0).getDate();
  return hexToBuffer(`${yy}${mm}${String(lastDay).padStart(2, '0')}`);
}

/** PAN as n..19 BCD, right-padded with 'F' to a whole byte. */
function panToBcd(pan: string): Buffer {
  const digits = String(pan || '').replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) throw new Error('VAULT_CARD_PAN_INVALID');
  return hexToBuffer(digits.length % 2 === 1 ? `${digits}F` : digits);
}

export interface VaultField55Options {
  pan: string;
  panSequence?: string;
  expiry: string;              // "MM/YY"
  atc: number;                 // ATC that will be used for this transaction
  amountMinor: number;
  currency: string;            // "USD" | "EUR" | "GBP" | "AED"
  unpredictableNumberHex?: string;
  transactionDateHex?: string;
  transactionTypeHex?: string;
  terminalCountryBcd?: string;
  tvrHex?: string;
  aidHex?: string;             // advertised AID (tag 84)
  appVersionHex?: string;
}

export interface VaultField55Result {
  field55: string;
  arqcHex: string;
  arpcHex: string;
  atcHex: string;
  cdol1Hex: string;
}

/**
 * Build a complete, cryptographically real Field 55 block for a vault card.
 *
 * Throws when the issuer master key is not configured: emitting a Field 55
 * without a real ARQC would be indistinguishable from a forged terminal.
 */
export function generateVaultField55WithCryptograms(
  options: VaultField55Options,
): VaultField55Result {
  const cryptoProvider = SoftwareEmvIssuerCrypto.fromEnvironment();

  const panSequence = String(options.panSequence || '00').padStart(2, '0');
  const atc = Number(options.atc);
  if (!Number.isInteger(atc) || atc <= 0 || atc > 0xffff) {
    throw new Error('VAULT_CARD_ATC_INVALID');
  }
  const atcHex = atc.toString(16).padStart(4, '0').toUpperCase();

  const currencyBcd = currencyToBcd(options.currency);
  const amountHex = encodeBcdAmount(options.amountMinor);

  const un = options.unpredictableNumberHex
    ? hexToBuffer(options.unpredictableNumberHex)
    : crypto.randomBytes(4);
  const txnDate = options.transactionDateHex
    ? hexToBuffer(options.transactionDateHex)
    : hexToBuffer(new Date().toISOString().slice(2, 10).replace(/-/g, ''));   // YYMMDD
  const txnType = options.transactionTypeHex ? hexToBuffer(options.transactionTypeHex) : hexToBuffer('00');
  const terminalCountry = options.terminalCountryBcd ? hexToBuffer(options.terminalCountryBcd) : hexToBuffer('0840');
  const tvr = options.tvrHex ? hexToBuffer(options.tvrHex) : hexToBuffer('0000000000');

  // IAD (9F10) is terminal-supplied in this profile and echoed back by the card,
  // so it is part of the MAC input. Format version 0x07 + 7 discretionary bytes
  // carrying the CVR-derived issuer decision bits.
  const iad = Buffer.concat([hexToBuffer('07'), crypto.randomBytes(7)]);

  const cdol1Values: Record<string, string | undefined> = {
    '9F02': amountHex,
    '9F03': '000000000000',
    '9F1A': terminalCountry.toString('hex').toUpperCase(),
    '95': tvr.toString('hex').toUpperCase(),
    '5F2A': currencyBcd,
    '9A': txnDate.toString('hex').toUpperCase(),
    '9C': txnType.toString('hex').toUpperCase(),
    '9F37': un.toString('hex').toUpperCase(),
    '9F36': atcHex,
    '9F10': iad.toString('hex').toUpperCase(),
  };
  const cdol1Hex = buildDolData(CDOL1_HEX, cdol1Values);

  const { arqc, arpc } = cryptoProvider.generate({
    pan: options.pan,
    panSequence,
    atc: atcHex,
    cdol1Hex,
  });

  const cvr = hexToBuffer('020102');           // 9F34 — no CVM performed, online
  const termCaps = hexToBuffer('E0F8C8');      // 9F33
  const termType = hexToBuffer('22');          // 9F35 — attended, offline with online capability
  const appVersion = hexToBuffer(options.appVersionHex || '008C'); // 9F09
  const aid = hexToBuffer(options.aidHex || 'A0000000031010');     // 84 — Visa AID
  const seqCounter = hexToBuffer('00000100');  // 9F41

  const field55 =
    tlv('5A',   panToBcd(options.pan)) +
    tlv('5F24', expiryToBcd(options.expiry)) +
    tlv('5F34', hexToBuffer(panSequence)) +
    tlv('82',   hexToBuffer(AIP_HEX)) +
    tlv('94',   hexToBuffer(AFL_HEX)) +
    tlv('9F26', hexToBuffer(arqc)) +
    tlv('9F27', hexToBuffer('80')) +        // CID — ARQC
    tlv('9F10', iad) +
    tlv('9F36', hexToBuffer(atcHex)) +
    tlv('9F37', un) +
    tlv('95',   tvr) +
    tlv('9B',   hexToBuffer('0000')) +
    tlv('9F02', hexToBuffer(amountHex)) +
    tlv('9F03', hexToBuffer('000000000000')) +
    tlv('5F2A', hexToBuffer(currencyBcd)) +
    tlv('9F1A', terminalCountry) +
    tlv('9A',   txnDate) +
    tlv('9C',   txnType) +
    tlv('9F33', termCaps) +
    tlv('9F34', cvr) +
    tlv('9F35', termType) +
    tlv('84',   aid) +
    tlv('9F09', appVersion) +
    tlv('9F41', seqCounter);

  return {
    field55,
    arqcHex: arqc,
    arpcHex: arpc,
    atcHex,
    cdol1Hex,
  };
}

/** Field 55 only — convenience wrapper for callers that do not need the ARPC. */
export function generateVaultField55(
  card: { pan: string; expiry: string; atc: number; panSequence?: string },
  amountMinor: number,
  currency: string,
): string {
  return generateVaultField55WithCryptograms({
    pan: card.pan,
    panSequence: card.panSequence,
    expiry: card.expiry,
    atc: card.atc,
    amountMinor,
    currency,
  }).field55;
}
