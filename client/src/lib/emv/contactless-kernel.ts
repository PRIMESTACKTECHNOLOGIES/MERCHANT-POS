/**
 * Contactless EMV Kernel — PPSE → AID → GPO → READ RECORD → Mode Detection
 *
 * Handles contactless (NFC) EMV transactions with mode switching:
 *   - qVSDC (Visa payWave Quick VSDC)
 *   - EMV (contactless EMV mode)
 *   - MAG (magstripe mode fallback)
 *
 * Contactless flow differs from contact EMV:
 *   1. PPSE (Proximity Payment System Environment) — "2PAY.SYS.DDF01"
 *   2. SELECT AID from PPSE-discovered applications
 *   3. GPO returns AIP + AFL (same as contact)
 *   4. READ RECORD (same as contact)
 *   5. Mode detection from AIP bits:
 *      - Bit 7 (0x80): qVSDC supported
 *      - Bit 6 (0x40): EMV mode supported
 *      - Otherwise: magstripe mode
 *
 * EMV Book 4 — Application Protocol for Contactless
 * EMVCo Contactless Specifications for Payment Systems (CPSS)
 */

import type { CardInterface } from './pos-apdu-bridge';
import { TLVParser } from './tlv-parser';
import type { EMVTag } from './tlv-parser';
import { AIDSelector } from './aid-selector';
import { GPOHandler } from './gpo-handler';
import { RecordReader } from './record-reader';
import type { RecordResult } from './record-reader';

// ── Types ──────────────────────────────────────────────────────────────────────

export type ContactlessMode = 'qVSDC' | 'EMV' | 'MAG';

export interface CTLResult {
  /** Detected contactless processing mode */
  mode: ContactlessMode;
  /** Selected Application Identifier */
  aid: string;
  /** Application label (ASCII) */
  label: string;
  /** Application Interchange Profile — hex */
  aip: string;
  /** Application File Locator — hex */
  afl: string;
  /** Merged TLV from SELECT + READ RECORD — hex */
  tlv: string;
  /** Parsed TLV tags */
  tags: EMVTag[];
  /** Raw record results */
  records: RecordResult[];
  /** Full FCI from SELECT — hex */
  fci: string;
  /** Payment scheme detected from AID */
  scheme?: PaymentScheme;
}

export type PaymentScheme = 'VISA' | 'MASTERCARD' | 'AMEX' | 'DISCOVER' | 'JCB' | 'UNIONPAY' | 'RUPAY' | 'UNKNOWN';

// ── Contactless Kernel ──────────────────────────────────────────────────────────

export class ContactlessKernel {
  private card: CardInterface;
  private aidSelector: AIDSelector;
  private gpo: GPOHandler;
  private reader: RecordReader;

  constructor(card: CardInterface) {
    this.card = card;
    this.aidSelector = new AIDSelector(card);
    this.gpo = new GPOHandler(card);
    this.reader = new RecordReader(card);
  }

  /**
   * Execute the full contactless EMV flow.
   *
   * @param terminalTLVHex  Terminal data TLV (hex) — for GPO PDOL
   * @param preferredAIDs   Optional preferred AIDs (tried after PPSE)
   * @returns               Contactless flow result with detected mode
   */
  async run(terminalTLVHex: string, preferredAIDs?: string[]): Promise<CTLResult> {
    // ── 1. SELECT PPSE ─────────────────────────────────────────────────────
    const aids = await this.aidSelector.selectPPSE();
    if (aids.length === 0) {
      // Try preferred AIDs if PPSE found nothing
      if (preferredAIDs && preferredAIDs.length > 0) {
        return this.runWithAID(preferredAIDs[0], terminalTLVHex);
      }
      throw new Error('NO_PPSE_AID');
    }

    // ── 2. SELECT AID ──────────────────────────────────────────────────────
    const selected = await this.aidSelector.selectAID(aids[0]);
    if (!selected) {
      // Try fallback to best application
      const fallback = await this.aidSelector.selectBestApplication(preferredAIDs);
      if (!fallback) {
        throw new Error('AID_SELECT_FAILED');
      }
      return this.buildResult(fallback, terminalTLVHex);
    }

    return this.buildResult(selected, terminalTLVHex);
  }

  /**
   * Run contactless flow with a specific AID (skip PPSE).
   *
   * @param aidHex          AID to select directly
   * @param terminalTLVHex  Terminal data TLV (hex)
   */
  async runWithAID(aidHex: string, terminalTLVHex: string): Promise<CTLResult> {
    const selected = await this.aidSelector.selectAID(aidHex);
    if (!selected) {
      throw new Error('AID_SELECT_FAILED');
    }
    return this.buildResult(selected, terminalTLVHex);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Build the contactless result from a selected application.
   * Performs GPO → READ RECORD → MERGE TLV → mode detection.
   */
  private async buildResult(
    selected: { aid: string; label?: string; raw: Uint8Array },
    terminalTLVHex: string
  ): Promise<CTLResult> {
    const aid = selected.aid;
    const label = selected.label || '';
    const fci = this.bytesToHex(selected.raw);

    // ── 3. GPO ─────────────────────────────────────────────────────────────
    const gpoResp = await this.gpo.process(fci, terminalTLVHex);
    const aip = gpoResp.aip;
    const afl = gpoResp.afl;

    // ── 4. READ RECORDS ────────────────────────────────────────────────────
    const records = afl.length > 0 ? await this.reader.readAFL(afl) : [];

    // ── 5. MERGE TLV (deduplicated) ────────────────────────────────────────
    const mergedTags: EMVTag[] = [];
    const seenTags = new Set<string>();

    // Add SELECT response TLV
    for (const tag of TLVParser.parseTLV(fci)) {
      if (!seenTags.has(tag.tag)) {
        mergedTags.push(tag);
        seenTags.add(tag.tag);
      }
    }

    // Add record TLVs
    for (const record of records) {
      for (const tag of record.tlv) {
        if (!seenTags.has(tag.tag)) {
          mergedTags.push(tag);
          seenTags.add(tag.tag);
        }
      }
    }

    // Build merged TLV hex
    const tlvHex = mergedTags.map(t => {
      const len = (t.value.length / 2).toString(16).padStart(2, '0');
      return t.tag + len + t.value;
    }).join('');

    // ── 6. DETECT MODE ─────────────────────────────────────────────────────
    const mode = this.detectMode(aip);
    const scheme = this.detectScheme(aid);

    return {
      mode,
      aid,
      label,
      aip,
      afl,
      tlv: tlvHex,
      tags: mergedTags,
      records,
      fci,
      scheme,
    };
  }

  /**
   * Detect contactless processing mode from AIP (Application Interchange Profile).
   *
   * AIP is 2 bytes. The first byte determines the mode:
   *   Bit 7 (0x80): qVSDC (Quick VSDC) — Visa payWave fast path
   *   Bit 6 (0x40): EMV mode — full contactless EMV processing
   *   Bit 5 (0x20): MSD (Magnetic Stripe Data) — legacy magstripe mode
   *
   * Priority: qVSDC > EMV > MAG
   *
   * @param aipHex  AIP hex string (4 chars = 2 bytes)
   * @returns       Detected contactless mode
   */
  detectMode(aipHex: string): ContactlessMode {
    if (!aipHex || aipHex.length < 2) return 'MAG';

    // Parse first byte of AIP
    const aipByte = parseInt(aipHex.substring(0, 2), 16);

    const supportsqVSDC = (aipByte & 0x80) !== 0;
    const supportsEMV = (aipByte & 0x40) !== 0;
    const supportsMSD = (aipByte & 0x20) !== 0;

    // Priority: qVSDC → EMV → MAG (MSD)
    if (supportsqVSDC) return 'qVSDC';
    if (supportsEMV) return 'EMV';
    if (supportsMSD) return 'MAG';
    return 'MAG';
  }

  /**
   * Detect payment scheme from AID.
   *
   * @param aidHex  AID hex string
   * @returns       Detected payment scheme
   */
  private detectScheme(aidHex: string): PaymentScheme {
    const aid = aidHex.toUpperCase();

    if (aid.startsWith('A000000004')) return 'MASTERCARD';
    if (aid.startsWith('A000000003')) return 'VISA';
    if (aid.startsWith('A000000025')) return 'AMEX';
    if (aid.startsWith('A000000604')) return 'DISCOVER';
    if (aid.startsWith('A000000065')) return 'JCB';
    if (aid.startsWith('A000000333')) return 'UNIONPAY';
    if (aid.startsWith('A000000524')) return 'RUPAY';

    return 'UNKNOWN';
  }

  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
}
