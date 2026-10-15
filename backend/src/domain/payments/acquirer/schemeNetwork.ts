/**
 * Card-network identity.
 *
 * Bridges three different ways of describing "which network is this card":
 *   - the EMV AID registry's scheme/product strings (contact and contactless
 *     chip reads),
 *   - the raw PAN's Issuer Identification Number (magnetic-stripe fallback or
 *     a server-side lookup),
 *   - Track 2 data.
 *
 * The result is a canonical `CardNetwork`, which is what the scheme routing
 * layer keys its sponsor endpoints on.
 *
 * Important: identifying the network does NOT grant access to it. Every network
 * below is a closed, membership-based network; the routing layer can only send
 * to an endpoint operated by a licensed acquirer/processor you are sponsored
 * through.
 */

import { resolveAid } from '../../../services/emv/emvAidRegistry';

export type CardNetwork =
  | 'VISA'
  | 'MASTERCARD'
  | 'AMEX'
  | 'UNIONPAY'
  | 'JCB'
  | 'DISCOVER'
  | 'DINERS'
  | 'OTHER';

export const CARD_NETWORKS: ReadonlyArray<CardNetwork> = [
  'VISA',
  'MASTERCARD',
  'AMEX',
  'UNIONPAY',
  'JCB',
  'DISCOVER',
  'DINERS',
  'OTHER',
];

const NETWORK_LABELS: Record<CardNetwork, string> = {
  VISA: 'Visa',
  MASTERCARD: 'Mastercard',
  AMEX: 'American Express',
  UNIONPAY: 'UnionPay',
  JCB: 'JCB',
  DISCOVER: 'Discover',
  DINERS: 'Diners Club',
  OTHER: 'Other / unknown network',
};

export function networkLabel(network: CardNetwork): string {
  return NETWORK_LABELS[network] || NETWORK_LABELS.OTHER;
}

interface IinRange {
  network: CardNetwork;
  low: number;
  high: number;
}

/**
 * Published Issuer Identification Number ranges, compared as a 6-digit prefix.
 * Ordered most-specific-first because some allocations nest: UnionPay's `62`
 * contains the legacy Discover China range 622126-622925, so Discover must be
 * tested before UnionPay.
 */
const IIN_RANGES: ReadonlyArray<IinRange> = [
  { network: 'AMEX', low: 340000, high: 349999 },
  { network: 'AMEX', low: 370000, high: 379999 },
  { network: 'JCB', low: 352800, high: 358999 },
  { network: 'DINERS', low: 300000, high: 305999 },
  { network: 'DINERS', low: 309500, high: 309599 },
  { network: 'DINERS', low: 360000, high: 369999 },
  { network: 'DINERS', low: 380000, high: 399999 },
  { network: 'MASTERCARD', low: 222100, high: 272099 },
  { network: 'MASTERCARD', low: 510000, high: 559999 },
  // Maestro BINs — processed on the Mastercard network.
  { network: 'MASTERCARD', low: 501800, high: 501899 },
  { network: 'MASTERCARD', low: 502000, high: 502099 },
  { network: 'MASTERCARD', low: 503800, high: 503899 },
  { network: 'MASTERCARD', low: 589300, high: 589399 },
  { network: 'MASTERCARD', low: 630400, high: 630499 },
  { network: 'MASTERCARD', low: 675900, high: 675999 },
  { network: 'MASTERCARD', low: 676100, high: 676399 },
  { network: 'DISCOVER', low: 622126, high: 622925 },
  { network: 'DISCOVER', low: 601100, high: 601199 },
  { network: 'DISCOVER', low: 644000, high: 649999 },
  { network: 'DISCOVER', low: 650000, high: 659999 },
  { network: 'VISA', low: 400000, high: 499999 },
  { network: 'UNIONPAY', low: 620000, high: 629999 },
  { network: 'UNIONPAY', low: 810000, high: 819999 },
];

/** Scheme/product strings (EMV AID registry) mapped to a canonical network. */
const SCHEME_PATTERNS: ReadonlyArray<[RegExp, CardNetwork]> = [
  [/^union\s*pay/i, 'UNIONPAY'],
  [/^american\s*express|^amex/i, 'AMEX'],
  [/^mastercard|^maestro|^cirrus/i, 'MASTERCARD'],
  [/^visa/i, 'VISA'],
  [/^jcb/i, 'JCB'],
  [/^diners/i, 'DINERS'],
  [/^discover/i, 'DISCOVER'],
];

/** Digits only, from any PAN-ish string. */
function digitsOnly(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

/** Classify a PAN by its 6-digit Issuer Identification Number prefix. */
export function detectNetworkFromPan(pan: string): CardNetwork {
  const digits = digitsOnly(pan);
  if (digits.length < 6) return 'OTHER';
  const prefix = Number(digits.slice(0, 6));
  for (const range of IIN_RANGES) {
    if (prefix >= range.low && prefix <= range.high) return range.network;
  }
  return 'OTHER';
}

/** Classify Track 2 data (PAN before the `=`/`D` field separator). */
export function detectNetworkFromTrack2(track2: string): CardNetwork {
  const pan = digitsOnly(String(track2 || '').split(/[=Dd]/)[0]);
  return detectNetworkFromPan(pan);
}

/**
 * Map an EMV AID registry scheme/product string to a canonical network.
 * Strings with no international routing identity (e.g. domestic schemes such
 * as CB, Dankort, Girocard, RuPay, Verve) resolve to `OTHER` and fall back to
 * the default sponsor route.
 */
export function normalizeNetwork(scheme?: string): CardNetwork {
  const value = String(scheme || '').trim();
  if (!value) return 'OTHER';
  for (const [pattern, network] of SCHEME_PATTERNS) {
    if (pattern.test(value)) return network;
  }
  return 'OTHER';
}

export interface NetworkResolutionInputs {
  /** EMV AID selected on the card, uppercase hex. */
  aid?: string;
  /** Scheme string (e.g. from the ACR122U reader's resolved scheme). */
  scheme?: string;
  /** Primary account number, digits or masked. */
  pan?: string;
  /** Track 2 data. */
  track2?: string;
}

export interface NetworkResolution {
  network: CardNetwork;
  label: string;
  /** Which input produced the answer. */
  source: 'scheme' | 'aid' | 'track2' | 'pan' | 'unknown';
  scheme?: string;
  product?: string;
}

/**
 * Resolve the card network from the strongest available evidence, in order:
 * an explicitly supplied scheme, then the AID registry, then Track 2, then the
 * PAN's IIN.
 */
export function resolveCardNetwork(inputs: NetworkResolutionInputs = {}): NetworkResolution {
  const { scheme, aid, pan, track2 } = inputs;

  if (scheme) {
    const network = normalizeNetwork(scheme);
    if (network !== 'OTHER') {
      return { network, label: networkLabel(network), source: 'scheme', scheme };
    }
  }

  if (aid) {
    const entry = resolveAid(aid);
    if (entry) {
      const network = normalizeNetwork(entry.scheme);
      if (network !== 'OTHER') {
        return {
          network,
          label: networkLabel(network),
          source: 'aid',
          scheme: entry.scheme,
          product: entry.product,
        };
      }
    }
  }

  if (track2) {
    const network = detectNetworkFromTrack2(track2);
    if (network !== 'OTHER') {
      return { network, label: networkLabel(network), source: 'track2' };
    }
  }

  if (pan) {
    const network = detectNetworkFromPan(pan);
    if (network !== 'OTHER') {
      return { network, label: networkLabel(network), source: 'pan' };
    }
  }

  return { network: 'OTHER', label: networkLabel('OTHER'), source: 'unknown', scheme };
}
