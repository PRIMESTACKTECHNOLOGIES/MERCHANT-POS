import { parseTlv } from './emv-tlv-parser';
import { processorConfig } from '../../config/acquirer';

export interface PreflightPayload {
  amountMinor: number;
  currency: string;
  pan?: string;
  expiry?: string;
  cvv?: string;
  emv?: Record<string, unknown>;
  terminalId?: string;
  merchantId?: string;
  stan?: string;
  /**
   * How the card was read. Accepts either the EMV label used by the POS clients
   * (CHIP, NFC, CONTACTLESS, MAGSTRIPE, MANUAL, VOICE_AUTH…) or the raw ISO 8583
   * DE22 value (05 chip, 02 mag-stripe, 91 contactless MSD…).
   *
   * Used by the downgrade guard: a card presented over the magnetic stripe / MSD
   * path is refused when chip is possible, which is what a contactless clone
   * relies on to spend a pre-played code.
   */
  entryMode?: string;
  /**
   * True only when the caller may actually approve the transaction OFFLINE.
   *
   * The offline-disallowed rules below (TVR "online required", offline PIN
   * required, AIP offline-data-auth unsupported) exist to stop an OFFLINE
   * approval of a card that must go online. An online authorization is the
   * correct outcome for exactly those cards, so the rules MUST NOT be applied
   * to it — otherwise every online-only card (which is every contactless card,
   * since AIP bit1=0 means "no offline SDA") is declined.
   *
   * Defaults to false (online). Only the offline batch upload path sets it.
   */
  allowOfflineApproval?: boolean;
}

export interface PreflightResult {
  declined: boolean;
  reason?: string;
  code?: string;
}

function parseHexTlvToTagMap(hex: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    // Strip spaces / punctuation, enforce even length
    const clean = String(hex || '').replace(/[^0-9A-Fa-f]/g, '');
    if (!clean || clean.length % 2 !== 0) return result;
    const buf = Buffer.from(clean, 'hex');
    const map = parseTlv(buf); // keyed by tag e.g. '95', values are Buffer
    for (const [tag, val] of Object.entries(map)) {
      try {
        result[String(tag).toUpperCase()] = (val as Buffer).toString('hex');
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore malformed */
  }
  return result;
}

/**
 * Classify how the card was read.
 *
 * Accepts the EMV label the POS clients send (CHIP, NFC, MAGSTRIPE…) and the
 * raw ISO 8583 DE22 value (leading two digits: 05 = chip, 02 = mag-stripe,
 * 90/91 = contactless magnetic stripe, 80 = fallback).
 */
function classifyEntryMode(raw: string): 'chip' | 'magstripe' | 'msd' | 'other' {
  const mode = String(raw || '').trim().toUpperCase();
  if (!mode) return 'other';

  const digits = mode.replace(/[^0-9]/g, '');
  if (digits.length >= 2) {
    const lead = digits.slice(0, 2);
    if (lead === '90' || lead === '91') return 'msd';
    if (lead === '02' || lead === '80') return 'magstripe';
    if (lead === '05' || lead === '07' || lead === '17') return 'chip';
  }

  if (mode.includes('MSD')) return 'msd';
  if (mode.includes('MAG') || mode.includes('STRIPE') || mode.includes('TRACK')) return 'magstripe';
  if (mode.includes('CHIP') || mode.includes('EMV') || mode.includes('NFC')
    || mode.includes('CONTACTLESS') || mode.includes('DIP')) return 'chip';
  return 'other';
}

/**
 * ══ HARD DECLINE PREFLIGHT — NO DEMO, NO STAND-IN, NO MOCK APPROVALS ═════════
 *
 * Single source of truth used by BOTH:
 *   (a) payments.service.processPosTransaction (real time card charges)
 *   (b) api.router /pos/offline-sale (SyncWorker offline batch uploads)
 *
 * If ANY of these 5 conditions match → DECLINE. Never approve.
 *
 *   1. Card details wrong → bad PAN length, bad Luhn, invalid expiry, invalid CVV
 *   2. Card has no balance / account empty / issuer AAC cryptogram (AAC = decline)
 *   3. Card blocked → hotlist / revocation / PIN locked / issuer auth failed
 *   4. Card NOT allowed OFFLINE → TVR go-online bits, no EMV TC, AIP offline-not-supported
 *   5. Card NOT allowed for INTERNATIONAL transfers → TVR byte5 bit2
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function syncOfflinePreflight(payload: PreflightPayload): PreflightResult {
  const pan = String(payload.pan || '').replace(/\s+/g, '');
  const exp = String(payload.expiry || '').replace(/\D/g, '');
  // Offline-disallowed rules only apply when an offline approval is actually
  // being attempted; an online authorization must never be declined for it.
  const allowOffline = payload.allowOfflineApproval === true;

  // ── 1. Wrong details ────────────────────────────────────────────────────
  if (pan) {
    if (pan.length < 13 || pan.length > 19) return { declined: true, reason: 'Card details wrong: invalid PAN length', code: 'PAN_INVALID' };
    if (/^\d+$/.test(pan)) {
      let s = 0, dbl = false;
      for (let i = pan.length - 1; i >= 0; i--) {
        let d = parseInt(pan[i], 10);
        if (dbl) { d *= 2; if (d > 9) d -= 9; }
        s += d; dbl = !dbl;
      }
      if (s % 10 !== 0) return { declined: true, reason: 'Card details wrong: PAN failed Luhn check', code: 'PAN_LUHN_FAIL' };
    }
  }
  if (exp) {
    const mm = parseInt(exp.slice(0, 2), 10);
    if (exp.length !== 4 || !(mm >= 1 && mm <= 12)) return { declined: true, reason: 'Card details wrong: invalid expiry', code: 'EXPIRY_INVALID' };
  }
  const cvv = String(payload.cvv || '').replace(/\D/g, '');
  if (payload.cvv && (cvv.length < 3 || cvv.length > 4)) return { declined: true, reason: 'Card details wrong: invalid CVV', code: 'CVV_INVALID' };

  // Decode EMV
  let tags: Record<string, string> = {};
  try {
    const tlvHex = String(payload.emv?.field55 || payload.emv?.field55Hex || payload.emv?.tlvRaw || payload.emv?.TLV || '').trim();
    if (tlvHex) tags = parseHexTlvToTagMap(tlvHex);
    Object.assign(tags, {
      tvr: String(payload.emv?.tvr || payload.emv?.TVR || tags['95'] || '').toLowerCase(),
      aip: String(payload.emv?.aip || payload.emv?.AIP || tags['82'] || '').toLowerCase(),
      cryptogramType: String(payload.emv?.cryptogramType || payload.emv?.cryptogram || '').toUpperCase(),
      cid: String(payload.emv?.cid || payload.emv?.CID || tags['9F27'] || '').toLowerCase(),
    });
  } catch {
    tags = {};
  }

  // ── DOWNGRADE GUARD ────────────────────────────────────────────────────
  //  A contactless clone (pre-play + downgrade) skips the chip protocol and
  //  presents the magnetic-stripe / MSD path instead, so the issuer never sees
  //  an ARQC it could reject. Two signatures are refused:
  //
  //    a) the entry mode claims a stripe read, yet chip data is present too —
  //       a card cannot be both, so the stripe path is a downgrade.
  //    b) the entry mode claims a stripe/MSD read above the terminal floor
  //       limit — chip is mandatory there, so the stripe read is not accepted.
  //
  //  Below the floor limit a genuine stripe card is still allowed through, so
  //  ordinary low-value contactless is unaffected.
  const entryKind = classifyEntryMode(String(payload.entryMode || ''));
  if (entryKind === 'msd' || entryKind === 'magstripe') {
    const field55Hex = String(
      payload.emv?.field55 || payload.emv?.field55Hex || payload.emv?.tlvRaw || payload.emv?.TLV || ''
    ).trim();
    const cryptogram = String(
      payload.emv?.cryptogramType || payload.emv?.cryptogram || payload.emv?.cid || ''
    ).trim();

    if (field55Hex || cryptogram) {
      return {
        declined: true,
        reason: 'Downgrade blocked: magnetic-stripe/MSD read presented alongside chip data',
        code: 'EMV_DOWNGRADE_BLOCKED',
      };
    }
    if (Number(payload.amountMinor) > processorConfig.floorLimit) {
      return {
        declined: true,
        reason: `Downgrade blocked: magnetic-stripe/MSD above the floor limit of ${processorConfig.floorLimit} minor units — chip is required`,
        code: 'EMV_DOWNGRADE_FLOOR_LIMIT',
      };
    }
  }

  // ── 2. No balance / issuer AAC ──────────────────────────────────────────
  const cType = (tags.cryptogramType || '').toUpperCase();
  const cidByte = tags.cid ? parseInt(tags.cid.slice(0, 2), 16) : null;
  if (cType === 'AAC') return { declined: true, reason: 'Issuer declined: AAC cryptogram (account empty / blocked / stop payment)', code: 'CARD_BLOCKED_AAC' };
  if (cidByte !== null && (cidByte & 0xC0) === 0x00) return { declined: true, reason: 'Issuer declined: CID=00 (AAC — insufficient funds / account empty)', code: 'CARD_BLOCKED_CID_AAC' };

  // ── TC GATE: If EMV chip already produced a TC cryptogram (CID=0x80) the
  //    issuer OFFICIALLY approved this offline per EMV kernel rules.
  //    "Offline not allowed" checks (TVR/AIP) below MUST NOT override a real
  //    TC approval. This is the core of YOUR OWN OFFLINE ACQUIRER: the chip's
  //    decision is final for offline-capable transactions.
  const isTcApproved = cType === 'TC' || (cidByte !== null && (cidByte & 0xC0) === 0x80);

  // TVR decode
  const tvr = (tags.tvr || '').padEnd(10, '0').slice(0, 10);
  if (tvr) {
    const b1 = parseInt(tvr.slice(0, 2), 16);
    const b2 = parseInt(tvr.slice(2, 4), 16);
    const b3 = parseInt(tvr.slice(4, 6), 16);
    const b4 = parseInt(tvr.slice(6, 8), 16);
    const b5 = parseInt(tvr.slice(8, 10), 16);

    // ── 3. Card blocked / hot list ───────────────────────────────────────
    if ((b2 & 0x01) === 0x01) return { declined: true, reason: 'Card blocked: appears on hot card / revocation list', code: 'CARD_BLOCKED_HOTLIST' };
    if ((b2 & 0x02) === 0x02) return { declined: true, reason: 'Card blocked: PIN try limit exceeded', code: 'CARD_BLOCKED_PIN_LOCKED' };
    if ((b4 & 0x01) === 0x01) return { declined: true, reason: 'Card blocked: issuer authentication failed', code: 'CARD_BLOCKED_ISSUER_AUTH' };
    if ((b1 & 0x20) === 0x20 || (b1 & 0x40) === 0x40) return { declined: true, reason: 'Card details wrong: SDA/DDA/CDA integrity check failed (card tampered)', code: 'EMV_AUTH_FAILED' };

    // ══ ONLY IF NOT TC-APPROVED (above gate) AND AN OFFLINE APPROVAL IS SOUGHT ══
    //    For an online authorization these conditions are the reason to go
    //    online, not a reason to decline.
    if (!isTcApproved && allowOffline) {
      // ── 4. Not allowed offline ───────────────────────────────────────
      if ((b3 & 0x01) === 0x01) return { declined: true, reason: 'Card not allowed for offline transactions (online required)', code: 'OFFLINE_NOT_ALLOWED' };
      if ((b1 & 0x80) === 0x80) return { declined: true, reason: 'Card requires online authorization (offline stand-in forbidden)', code: 'OFFLINE_NOT_ALLOWED_TVR' };
      if ((b2 & 0x80) === 0x80) return { declined: true, reason: 'Card not allowed offline: offline PIN required but PIN not entered', code: 'OFFLINE_NOT_ALLOWED_PIN_REQUIRED' };
    }

    // ── 5. Not allowed international (ALWAYS enforced even for TC) ──────
    if ((b5 & 0x02) === 0x02) return { declined: true, reason: 'Card not allowed for international transfers', code: 'INTERNATIONAL_NOT_ALLOWED' };
  }

  // ── 4. AIP offline support check — only when an offline approval is sought ─
  //    AIP bit1=0 means the card has no offline data authentication and MUST be
  //    authorized online. Sent online (the default), that is a valid card.
  const aipByte = tags.aip ? parseInt(tags.aip.slice(0, 2), 16) : null;
  if (allowOffline && !isTcApproved && aipByte !== null && (aipByte & 0x02) === 0x00 && pan && /^\d+$/.test(pan)) {
    // AIP bit1=0 means offline data auth not supported → must go online.
    return { declined: true, reason: 'Card not allowed offline: AIP indicates online-only card', code: 'OFFLINE_NOT_ALLOWED_AIP' };
  }

  return { declined: false };
}

/**
 * Legacy name — same function. Used by api.router's old `require()`.
 */
export const offlineEmvDeclinePreflight = syncOfflinePreflight;
