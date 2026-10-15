/**
 * EMV Application Identifier (AID) registry.
 *
 * Source: EMV card-scheme RID/PIX/AID table (Wikipedia "EMV" article, 14 Sep 2020),
 * captured in NEW IMPLEMENTS/97164c83189903cd.pdf.
 *
 * An AID is the concatination of a 5-byte Registered Application Provider
 * Identifier (RID) and a variable-length Proprietary Application Identifier
 * Extension (PIX). Selection is by longest-prefix match on the AID prefix.
 */

export interface EmvAidEntry {
  /** Full AID, uppercase hex (RID + PIX). */
  aid: string;
  /** 5-byte Registered Application Provider Identifier, uppercase hex. */
  rid: string;
  /** Proprietary Application Identifier Extension, uppercase hex (may be empty). */
  pix: string;
  /** Card scheme / brand. */
  scheme: string;
  /** Product name inside the scheme. */
  product: string;
}

/** Canonical registry, ordered by scheme. */
export const EMV_AID_REGISTRY: ReadonlyArray<EmvAidEntry> = [
  { aid: 'A0000000031010', rid: 'A000000003', pix: '1010', scheme: 'Visa', product: 'Visa credit or debit' },
  { aid: 'A0000000032010', rid: 'A000000003', pix: '2010', scheme: 'Visa', product: 'Visa Electron' },
  { aid: 'A0000000032020', rid: 'A000000003', pix: '2020', scheme: 'Visa', product: 'V PAY' },
  { aid: 'A0000000038010', rid: 'A000000003', pix: '8010', scheme: 'Visa', product: 'Plus (ATM)' },
  { aid: 'A0000000041010', rid: 'A000000004', pix: '1010', scheme: 'Mastercard', product: 'Mastercard credit or debit' },
  { aid: 'A0000000043060', rid: 'A000000004', pix: '3060', scheme: 'Mastercard', product: 'Maestro (debit)' },
  { aid: 'A0000000046000', rid: 'A000000004', pix: '6000', scheme: 'Mastercard', product: 'Cirrus (ATM only)' },
  { aid: 'A0000000049999', rid: 'A000000004', pix: '9999', scheme: 'Mastercard', product: 'Mastercard (secondary)' },
  { aid: 'A0000000050001', rid: 'A000000005', pix: '0001', scheme: 'Mastercard', product: 'Maestro UK (Switch)' },
  { aid: 'A00000002501', rid: 'A000000025', pix: '01', scheme: 'American Express', product: 'American Express' },
  { aid: 'A0000000291010', rid: 'A000000029', pix: '1010', scheme: 'LINK', product: 'LINK ATM (UK)' },
  { aid: 'A0000000421010', rid: 'A000000042', pix: '1010', scheme: 'CB', product: 'CB credit or debit (France)' },
  { aid: 'A0000000422010', rid: 'A000000042', pix: '2010', scheme: 'CB', product: 'CB debit only (France)' },
  { aid: 'A0000000651010', rid: 'A000000065', pix: '1010', scheme: 'JCB', product: 'Japan Credit Bureau' },
  { aid: 'A0000001211010', rid: 'A000000121', pix: '1010', scheme: 'Dankort', product: 'Dankort debit (Denmark)' },
  { aid: 'A0000001410001', rid: 'A000000141', pix: '0001', scheme: 'CoGeBan', product: 'PagoBANCOMAT (Italy)' },
  { aid: 'A0000001523010', rid: 'A000000152', pix: '3010', scheme: 'Discover', product: 'Diners Club / Discover' },
  { aid: 'A0000001544442', rid: 'A000000154', pix: '4442', scheme: 'Banrisul', product: 'BanricomprasDebito (Brazil)' },
  { aid: 'A00000022820101010', rid: 'A000000228', pix: '20101010', scheme: 'SPAN2', product: 'SPAN (Saudi Arabia)' },
  { aid: 'A0000002771010', rid: 'A000000277', pix: '1010', scheme: 'Interac', product: 'Interac debit (Canada)' },
  { aid: 'A0000003241010', rid: 'A000000324', pix: '1010', scheme: 'Discover', product: 'Discover ZIP' },
  { aid: 'A000000333010101', rid: 'A000000333', pix: '010101', scheme: 'UnionPay', product: 'UnionPay Debit' },
  { aid: 'A000000333010102', rid: 'A000000333', pix: '010102', scheme: 'UnionPay', product: 'UnionPay Credit' },
  { aid: 'A000000333010103', rid: 'A000000333', pix: '010103', scheme: 'UnionPay', product: 'UnionPay Quasi Credit' },
  { aid: 'A000000333010106', rid: 'A000000333', pix: '010106', scheme: 'UnionPay', product: 'UnionPay Electronic Cash' },
  { aid: 'A0000003591010028001', rid: 'A000000359', pix: '1010028001', scheme: 'ZKA', product: 'Girocard (Germany)' },
  { aid: 'A00000035910100380', rid: 'A000000359', pix: '10100380', scheme: 'EAPS BANCOMAT', product: 'PagoBANCOMAT (Italy)' },
  { aid: 'A0000003710001', rid: 'A000000371', pix: '0001', scheme: 'Verve', product: 'Verve (Nigeria)' },
  { aid: 'A0000004391010', rid: 'A000000439', pix: '1010', scheme: 'The Exchange Network', product: 'ATM Network' },
  { aid: 'A0000005241010', rid: 'A000000524', pix: '1010', scheme: 'RuPay', product: 'RuPay (India)' },
];

/**
 * AIDs tried in order when the card does not expose a usable PPSE directory.
 * Contactless-first (QuickPass / PayPass / payWave) entries come first.
 */
const FALLBACK_PRIORITY: ReadonlyArray<string> = [
  'A0000000031010', // Visa
  'A0000000041010', // Mastercard
  'A000000333010101', // UnionPay Debit
  'A0000000651010', // JCB
  'A00000002501', // American Express
  'A0000000032010', // Visa Electron
  'A0000000032020', // V PAY
  'A0000000043060', // Maestro
  'A0000001523010', // Discover
  'A0000005241010', // RuPay
];

/** Ordered list of AID hex strings for blind application selection. */
export function fallbackAids(): string[] {
  return [...FALLBACK_PRIORITY];
}

function normalizeAid(aid: string): string {
  return String(aid || '').replace(/\s+/g, '').toUpperCase();
}

/**
 * Resolve an AID to its registry entry using longest-prefix match.
 * Cards frequently return a longer AID (extra PIX bytes) than the registry
 * entry, so an exact match alone is not enough.
 */
export function resolveAid(aid: string): EmvAidEntry | null {
  const target = normalizeAid(aid);
  if (!target) return null;

  let best: EmvAidEntry | null = null;
  for (const entry of EMV_AID_REGISTRY) {
    if (target.startsWith(entry.aid) || entry.aid.startsWith(target)) {
      if (!best || entry.aid.length > best.aid.length) {
        best = entry;
      }
    }
  }
  return best;
}

/** Resolve the card scheme (brand) for an AID, or "Unknown". */
export function resolveScheme(aid: string): string {
  return resolveAid(aid)?.scheme || 'Unknown';
}

/** All registered AIDs as uppercase hex strings. */
export function allAids(): string[] {
  return EMV_AID_REGISTRY.map((entry) => entry.aid);
}
