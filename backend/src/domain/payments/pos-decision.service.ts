import { db } from "../../config/db";
import axios from 'axios';
import { settingsService } from "../settings/settings.service";
import {
  PosDecision,
  PosMode,
  PosDecisionResult,
  OdaResult,
  CvmResult,
  TerminalConfig,
  MerchantProfile,
  OdaErrorCode,
} from "./pos.types";
import { odaErrorReason } from "../../utils/odaErrorCodes";

export interface PosDecisionPayload {
  merchantId: string;
  terminalId: string;
  amountMinor: number;
  currency: string;
  card?: {
    pan?: string;
    expiry?: string;
    cvv?: string;
    panMasked?: string;
  };
  emv?: Record<string, any>;
  oda?: OdaResult;
}

export type OnlineAuthorizationResult = {
  success: boolean;
  status: string;
  processor: PosDecisionResult['processor'];
  authCode?: string;
  paymentIntentId?: string;
  error?: string;
};

export type ParsedCvmResult = CvmResult & {
  raw?: string;
  status: "UNKNOWN" | "SUCCESS" | "FAIL" | "REQUIRE_ONLINE";
};

export type PosDecisionServiceResult = PosDecisionResult & {
  onlineRequired: boolean;
  amountMinor: number;
  currency: string;
  merchantId: string;
  terminalId: string;
  terminalOfflineEnabled: boolean;
  offlineAllowed: boolean;
  blacklisted: boolean;
  expired: boolean;
};

function buildEmvPayload(emv: any): Record<string, unknown> | undefined {
  const payload: Record<string, unknown> = {};

  const field55 = emv?.field55 || emv?.field55Hex || emv?.field55hex || emv?.tlvRaw || emv?.TLV;
  if (field55) payload.field55 = String(field55);

  const track2 = emv?.track2 || emv?.track2EquivalentData || emv?.['57'];
  if (track2) payload.track2 = String(track2);

  const aid = emv?.aid || emv?.AID || emv?.aidHex || emv?.['9F06'];
  if (aid) payload.aid = String(aid);

  const cryptogram = emv?.cryptogram || emv?.arqc || emv?.['9F26'];
  if (cryptogram) payload.cryptogram = String(cryptogram);

  const atc = emv?.atc || emv?.['9F36'];
  if (atc) payload.atc = String(atc);

  const cvmResult = emv?.cvmResult || emv?.['9F34'];
  if (cvmResult) payload.cvmResult = String(cvmResult);

  return Object.keys(payload).length > 0 ? payload : undefined;
}

async function goOnline(
  emv: any,
  amount: number,
  oda: OdaResult,
  cvm: CvmResult,
  merchantId?: string,
  terminalId?: string
): Promise<PosDecisionResult> {
  // No processor configured → hard decline. No mock, no stand-in.
  const processorUrl = (process.env.CARD_PROCESSOR_URL || process.env.CARD_PROCESSOR_AUTH_URL || '').trim();
  if (!processorUrl) {
    return {
      decision: PosDecision.DECLINE,
      mode: PosMode.ONLINE,
      reason: 'Card processor not configured — transaction declined. Set CARD_PROCESSOR_URL.',
      oda,
      cvm,
      processor: {
        approved: false,
        reason: 'No card processor configured.',
      },
    };
  }
  // Processor IS configured but this path was called — decline as online unavailable
  return {
    decision: PosDecision.DECLINE,
    mode: PosMode.ONLINE,
    reason: 'Online authorization required but could not complete.',
    oda,
    cvm,
    processor: {
      approved: false,
      reason: 'Online authorization could not complete.',
    },
  };
}

function isCardExpired(emv: any): boolean {
  const exp = String(emv?.expiry || emv?.['5F24'] || "");
  const cleaned = exp.replace(/[^0-9]/g, '');
  if (cleaned.length !== 4) return false;
  const year = 2000 + Number(cleaned.slice(0, 2));
  const month = Number(cleaned.slice(2, 4));
  if (month < 1 || month > 12) return false;
  const expiryDate = new Date(year, month, 0, 23, 59, 59, 999);
  return new Date() > expiryDate;
}

function isPanBlacklisted(pan: string): boolean {
  if (!pan) return false;
  const cleaned = pan.replace(/\D/g, '');
  return false;
}

function randomSelectionTriggered(rate: number): boolean {
  return Math.random() < Math.max(0, Math.min(rate, 1));
}

function velocityTooHigh(_pan: string): boolean {
  return false;
}

export async function decidePosOutcome(
  emv: any,
  oda: OdaResult,
  cvm: CvmResult,
  terminal: TerminalConfig,
  merchant: MerchantProfile,
  amount: number,
  merchantId?: string,
  terminalId?: string
): Promise<PosDecisionResult> {
  try {
    if (!oda.performed || !oda.success) {
      const finalReason = oda.reason
        ? oda.errorCode
          ? `[${oda.errorCode}] ${oda.reason}`
          : oda.reason
        : oda.errorCode
        ? odaErrorReason(oda.errorCode)
        : "EMV offline data authentication failed";
      return {
        decision: PosDecision.DECLINE,
        mode: PosMode.ONLINE,
        reason: finalReason,
        oda,
        cvm,
      };
    }

    if (isCardExpired(emv)) {
      return {
        decision: PosDecision.DECLINE,
        mode: PosMode.ONLINE,
        reason: "Card expired",
        oda,
        cvm,
      };
    }

    if (isPanBlacklisted(emv?.pan || "")) {
      return {
        decision: PosDecision.DECLINE,
        mode: PosMode.ONLINE,
        reason: "Card blocked",
        oda,
        cvm,
      };
    }

    if (terminal.onlineOnly || merchant.highRisk || amount > terminal.offlineFloorLimit) {
      return await goOnline(emv, amount, oda, cvm, merchantId, terminalId);
    }

    if (randomSelectionTriggered(terminal.randomOnlineRate)) {
      return await goOnline(emv, amount, oda, cvm, merchantId, terminalId);
    }

    if (velocityTooHigh(emv?.pan || "")) {
      return await goOnline(emv, amount, oda, cvm, merchantId, terminalId);
    }

    if (oda.success && cvm.ok && amount <= terminal.offlineFloorLimit) {
      return {
        decision: PosDecision.DECLINE,
        mode: PosMode.ONLINE,
        reason: 'Offline auto-approve disabled — online authorization required for all transactions.',
        oda,
        cvm,
      };
    }

    return await goOnline(emv, amount, oda, cvm, merchantId, terminalId);
  } catch (err: any) {
    return {
      decision: PosDecision.DECLINE,
      mode: PosMode.ONLINE,
      reason: `POS decision error: ${err?.message || "Unknown error"}`,
      oda,
      cvm,
    };
  }
}

const DEFAULT_OFFLINE_FLOOR_LIMIT_MINOR = Number(process.env.POS_OFFLINE_FLOOR_LIMIT_MINOR || '25000');
const BLACKLISTED_PANS = (process.env.POS_BLACKLIST_PANS || '').split(',').map(p => p.trim()).filter(Boolean);

export class PosDecisionService {
  async decide(payload: PosDecisionPayload): Promise<PosDecisionServiceResult> {
    const merchantId = payload.merchantId;
    const terminalId = payload.terminalId;
    const amountMinor = Number(payload.amountMinor || 0);
    const currency = payload.currency || 'USD';

    const terminal = await this.getTerminalConfig(merchantId, terminalId);
    const merchantSettings = await settingsService.getSettings(merchantId);

    const terminalOfflineEnabled = Boolean(terminal?.offline_enabled === 1 || terminal?.offline_enabled === true);
    // offlineAllowed is always false — online auth required for all transactions
    const merchantOfflineMode = false;
    const offlineAllowedByConfig = false;

    const pan = this.getPan(payload);
    const expiry = this.getExpiry(payload);
    const cvmRaw = this.getCvmRaw(payload);
    const oda: OdaResult = payload.oda || { performed: false, success: false, reason: 'ODA unavailable' };

    const expired = expiry ? this.isExpiryExpired(expiry) : true;
    const blacklisted = pan ? await this.isPanBlacklisted(pan) : false;
    const cvm = this.parseCvmResult(cvmRaw);

    const odaFailed = oda?.performed === true && oda.success === false;
    const requireOnlineByCvm = cvm.status === 'REQUIRE_ONLINE';
    const requireDeclineByCvm = cvm.status === 'FAIL';
    const reasons: string[] = [];

    if (!merchantId || !terminalId) {
      return this.createDeclineResult(payload, 'Missing merchantId or terminalId', terminalOfflineEnabled, false, false, false, oda, cvm);
    }

    if (!pan) {
      return this.createDeclineResult(payload, 'Card PAN unavailable', terminalOfflineEnabled, false, false, false, oda, cvm);
    }

    if (!expiry) {
      return this.createDeclineResult(payload, 'Card expiry unavailable', terminalOfflineEnabled, false, false, false, oda, cvm);
    }

    if (expired) {
      reasons.push('Card expired');
    }

    if (blacklisted) {
      reasons.push('Card is blacklisted');
    }

    if (odaFailed) {
      const odaCode = (oda?.errorCode as OdaErrorCode | undefined);
      const odaMsg =
        oda?.reason ||
        (odaCode ? odaErrorReason(odaCode) : 'Offline Data Authentication failed');
      const odaQualifier = odaCode ? `[${odaCode}] ` : '';
      reasons.push(`${odaQualifier}${odaMsg}`);
    }

    if (requireDeclineByCvm) {
      reasons.push('Cardholder verification failed');
    }

    const effectiveFloorLimit = this.getOfflineFloorLimit(merchantSettings);
    // aboveFloor check kept for logging only — offline auto-approve is disabled regardless
    const aboveFloor = amountMinor > effectiveFloorLimit;
    if (aboveFloor) {
      reasons.push(`Amount above offline floor limit (${effectiveFloorLimit}) — online auth required`);
    }

    const offlineAllowed = false; // Offline auto-approve DISABLED — online auth required always

    if (expired || blacklisted || odaFailed || requireDeclineByCvm) {
      return this.createDeclineResult(payload, reasons.join(' / '), terminalOfflineEnabled, offlineAllowed, expired, blacklisted, oda, cvm);
    }

    // Always go online — no floor-limit auto-approve
    const onlineDecision = await this.performOnlineAuthorization(payload, pan, expiry, currency, amountMinor);
    if (onlineDecision.success) {
      return this.createOnlineApproveResult(payload, onlineDecision.processor, terminalOfflineEnabled, false, expired, blacklisted, oda, cvm);
    }
    return this.createDeclineResult(
      payload,
      onlineDecision.status === 'UNAVAILABLE'
        ? 'Card processor not configured — transaction declined. Set CARD_PROCESSOR_URL to accept card payments.'
        : `Online authorization failed: ${onlineDecision.error || onlineDecision.status}`,
      terminalOfflineEnabled, false, expired, blacklisted, oda, cvm, onlineDecision.processor
    );
  }

  private getPan(payload: PosDecisionPayload): string | undefined {
    return payload.card?.pan || payload.emv?.pan || payload.emv?.PAN || payload.emv?.PAN?.toString?.();
  }

  private getExpiry(payload: PosDecisionPayload): string | undefined {
    return payload.card?.expiry || payload.emv?.expiry || payload.emv?.Expiry || payload.emv?.['5F24'];
  }

  private getCvmRaw(payload: PosDecisionPayload): string | undefined {
    return payload.emv?.cvmResult || payload.emv?.['9F34'] || undefined;
  }

  private isExpiryExpired(expiry: string): boolean {
    const normalized = expiry.replace(/[^0-9]/g, '');
    if (normalized.length !== 4) {
      return true;
    }

    let month: number;
    let year: number;

    const first = Number(normalized.slice(0, 2));
    const second = Number(normalized.slice(2, 4));

    if (first >= 1 && first <= 12) {
      month = first;
      year = 2000 + second;
    } else {
      month = second;
      year = 2000 + first;
    }

    if (month < 1 || month > 12) {
      return true;
    }

    const expiryDate = new Date(year, month, 0, 23, 59, 59, 999);
    return expiryDate < new Date();
  }

  private parseCvmResult(raw?: string): ParsedCvmResult {
    if (!raw) {
      return { ok: false, status: 'UNKNOWN' };
    }

    const sanitized = raw.replace(/[^0-9a-fA-F]/g, '');
    if (sanitized.length < 6) {
      return { ok: false, raw: sanitized, status: 'UNKNOWN' };
    }

    try {
      const buffer = Buffer.from(sanitized, 'hex');
      const resultByte = buffer.length >= 3 ? buffer[2] : null;

      if (resultByte === null) {
        return { ok: false, raw: sanitized, status: 'UNKNOWN' };
      }

      if (resultByte === 0x01) {
        return { ok: true, raw: sanitized, status: 'SUCCESS' };
      }
      if (resultByte === 0x00) {
        return { ok: false, raw: sanitized, status: 'FAIL' };
      }
      return { ok: false, raw: sanitized, status: 'REQUIRE_ONLINE' };
    } catch {
      return { ok: false, raw: raw, status: 'UNKNOWN' };
    }
  }

  private async getTerminalConfig(merchantId: string, terminalId: string) {
    try {
      const res = await db.query(`SELECT * FROM terminals WHERE merchant_id = ? AND terminal_id = ? LIMIT 1`, [merchantId, terminalId]);
      return res.rows.length ? res.rows[0] : null;
    } catch {
      return null;
    }
  }

  private async isPanBlacklisted(pan: string): Promise<boolean> {
    const sanitized = pan.replace(/\D/g, '');
    if (!sanitized) {
      return false;
    }

    for (const prefix of BLACKLISTED_PANS) {
      if (prefix && sanitized.startsWith(prefix.replace(/\D/g, ''))) {
        return true;
      }
    }

    try {
      const res = await db.query(`SELECT pan_prefix FROM card_blacklist`);
      for (const row of res.rows) {
        const prefix = String(row.pan_prefix || '').replace(/\D/g, '');
        if (prefix && sanitized.startsWith(prefix)) {
          return true;
        }
      }
    } catch {
      // ignore blacklist lookup failure
    }

    return false;
  }

  private getOfflineFloorLimit(merchantSettings: any): number {
    if (merchantSettings?.terminal?.offlineFloorLimitMinor) {
      return Number(merchantSettings.terminal.offlineFloorLimitMinor) || DEFAULT_OFFLINE_FLOOR_LIMIT_MINOR;
    }
    return DEFAULT_OFFLINE_FLOOR_LIMIT_MINOR;
  }

  private async performOnlineAuthorization(
    _payload: PosDecisionPayload,
    _pan: string,
    _expiry: string,
    _currency: string,
    _amountMinor: number
  ): Promise<OnlineAuthorizationResult> {
    try {
      const processorUrl = (process.env.CARD_PROCESSOR_URL || process.env.CARD_PROCESSOR_AUTH_URL || '').trim();
      if (!processorUrl) {
        return {
          success: false,
          status: 'UNAVAILABLE',
          processor: { approved: false, reason: 'Processor URL not configured' },
          error: 'Card processor URL not configured (CARD_PROCESSOR_URL or CARD_PROCESSOR_AUTH_URL)'
        };
      }

      // Build a compact EMV payload if available
      const emvPayload = buildEmvPayload((_payload && (_payload as any).emv) || {}) || undefined;

      const reqBody: Record<string, unknown> = {
        amountMinor: _amountMinor,
        currency: _currency,
        pan: _pan,
        expiry: _expiry,
        emv: emvPayload,
        stan: (_payload && (_payload as any).stan) || undefined,
        merchantId: _payload?.merchantId,
        terminalId: _payload?.terminalId,
      };

      const resp = await axios.post(processorUrl, reqBody, { timeout: 10000 });
      const data = resp?.data || {};

      const approved = data?.approved === true || /approved/i.test(String(data?.status || data?.message || '')) || data?.success === true;

      if (approved) {
        return {
          success: true,
          status: data?.status || 'APPROVED',
          processor: {
            approved: true,
            reason: data?.message || 'Approved by processor',
            authCode: data?.authCode || data?.authorizationCode || undefined,
            processorId: data?.processorId || data?.paymentIntentId || data?.id || undefined
          },
          authCode: data?.authCode || data?.authorizationCode || undefined,
          paymentIntentId: data?.paymentIntentId || data?.processorId || data?.id || undefined
        };
      }

      return {
        success: false,
        status: data?.status || 'DECLINED',
        processor: {
          approved: false,
          reason: data?.message || 'Declined by processor'
        },
        error: data?.message || 'Processor declined the transaction'
      };

    } catch (err: any) {
      return {
        success: false,
        status: 'ERROR',
        processor: { approved: false, reason: err?.message || 'Processor call error' },
        error: err?.message || String(err)
      };
    }
  }

  private createOfflineApproveResult(
    payload: PosDecisionPayload,
    reason: string,
    terminalOfflineEnabled: boolean,
    offlineAllowed: boolean,
    expired: boolean,
    blacklisted: boolean,
    oda: OdaResult,
    cvm: ParsedCvmResult
  ): PosDecisionServiceResult {
    return {
      decision: PosDecision.OFFLINE_APPROVE,
      mode: PosMode.OFFLINE,
      reason,
      onlineRequired: false,
      amountMinor: payload.amountMinor,
      currency: payload.currency || 'USD',
      merchantId: payload.merchantId,
      terminalId: payload.terminalId,
      terminalOfflineEnabled,
      offlineAllowed,
      blacklisted,
      expired,
      oda,
      cvm,
    };
  }

  private createOnlineApproveResult(
    payload: PosDecisionPayload,
    processor: PosDecisionResult['processor'],
    terminalOfflineEnabled: boolean,
    offlineAllowed: boolean,
    expired: boolean,
    blacklisted: boolean,
    oda: OdaResult,
    cvm: ParsedCvmResult
  ): PosDecisionServiceResult {
    return {
      decision: PosDecision.ONLINE_APPROVE,
      mode: PosMode.ONLINE,
      reason: 'Online authorization succeeded',
      onlineRequired: true,
      amountMinor: payload.amountMinor,
      currency: payload.currency || 'USD',
      merchantId: payload.merchantId,
      terminalId: payload.terminalId,
      terminalOfflineEnabled,
      offlineAllowed,
      blacklisted,
      expired,
      oda,
      cvm,
      processor,
    };
  }

  private createDeclineResult(
    payload: PosDecisionPayload,
    reason: string,
    terminalOfflineEnabled: boolean,
    offlineAllowed: boolean,
    expired: boolean,
    blacklisted: boolean,
    oda: OdaResult,
    cvm: ParsedCvmResult,
    processor?: PosDecisionResult['processor']
  ): PosDecisionServiceResult {
    return {
      decision: PosDecision.DECLINE,
      mode: PosMode.ONLINE,
      reason,
      onlineRequired: false,
      amountMinor: payload.amountMinor,
      currency: payload.currency || 'USD',
      merchantId: payload.merchantId,
      terminalId: payload.terminalId,
      terminalOfflineEnabled,
      offlineAllowed,
      blacklisted,
      expired,
      oda,
      cvm,
      processor,
    };
  }
}

export const posDecisionService = new PosDecisionService();
