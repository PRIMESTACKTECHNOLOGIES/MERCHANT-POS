/**
 * Protocol 101.1 — Voice Authorization Code System
 *
 * Follows the same AA BB CC structure as protocol-2013-codes.ts.
 *
 * System Family for 101.1 = 01 (Voice Auth engine)
 *   BB = Module (01–09)
 *   CC = Action / Status (01–99 — shares ActionCode enum from 201.3)
 *
 * Canonical example: 010302 = VOICE_AUTH / VALIDATE / FAILED
 */

import { ActionCode, buildCode, ProtocolEvent } from './protocol-2013-codes';
export { ActionCode };

// ── System family ──────────────────────────────────────────────────────────
export const VOICE_AUTH_FAMILY = 1; // AA = 01

// ── Modules (BB) ──────────────────────────────────────────────────────────
export enum VoiceAuthModule {
  INTAKE    = 1, // Inbound registration of voice-auth funds
  VALIDATE  = 2, // Auth-code + ledger validation rules
  REGISTER  = 3, // card_authorizations row creation
  CAPTURE   = 4, // merchant wallet credit (confirmInternalCapture equivalent)
  SETTLE    = 5, // settlement batch + transaction_settlements row
  REVERSE   = 6, // reversal / void of a captured voice-auth
  QUERY     = 7, // read-only status queries
  BATCH     = 8, // end-of-day batch building
}

// ── Named codes ────────────────────────────────────────────────────────────
export const P1011 = {
  // INTAKE
  INTAKE_STARTED:           buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.INTAKE,    ActionCode.STARTED),
  INTAKE_SUCCESS:           buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.INTAKE,    ActionCode.SUCCESS),
  INTAKE_FAILED:            buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.INTAKE,    ActionCode.FAILED),

  // VALIDATE
  VALIDATE_STARTED:         buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.VALIDATE,  ActionCode.STARTED),
  VALIDATE_SUCCESS:         buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.VALIDATE,  ActionCode.SUCCESS),
  VALIDATE_FAILED:          buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.VALIDATE,  ActionCode.FAILED),
  VALIDATE_DECLINED:        buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.VALIDATE,  ActionCode.DECLINED),

  // REGISTER
  REGISTER_STARTED:         buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.REGISTER,  ActionCode.STARTED),
  REGISTER_SUCCESS:         buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.REGISTER,  ActionCode.SUCCESS),
  REGISTER_FAILED:          buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.REGISTER,  ActionCode.FAILED),

  // CAPTURE
  CAPTURE_STARTED:          buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.CAPTURE,   ActionCode.STARTED),
  CAPTURE_SUCCESS:          buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.CAPTURE,   ActionCode.SUCCESS),
  CAPTURE_FAILED:           buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.CAPTURE,   ActionCode.FAILED),
  CAPTURE_CREDITED:         buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.CAPTURE,   ActionCode.CREDITED),

  // SETTLE
  SETTLE_STARTED:           buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.SETTLE,    ActionCode.STARTED),
  SETTLE_SUCCESS:           buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.SETTLE,    ActionCode.SUCCESS),
  SETTLE_FAILED:            buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.SETTLE,    ActionCode.FAILED),

  // REVERSE
  REVERSE_STARTED:          buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.REVERSE,   ActionCode.STARTED),
  REVERSE_SUCCESS:          buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.REVERSE,   ActionCode.SUCCESS),
  REVERSE_FAILED:           buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.REVERSE,   ActionCode.FAILED),

  // BATCH
  BATCH_BUILD_STARTED:      buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.BATCH,     ActionCode.STARTED),
  BATCH_BUILD_SUCCESS:      buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.BATCH,     ActionCode.SUCCESS),
  BATCH_BUILD_FAILED:       buildCode(VOICE_AUTH_FAMILY, VoiceAuthModule.BATCH,     ActionCode.FAILED),
};

export { ProtocolEvent };

export const P1011_MEANING: Record<string, string> = Object.fromEntries(
  Object.entries(P1011).map(([k, v]) => [String(v), k.replace(/_/g, ' ')]),
);

export function explain1011(code: string): string {
  return P1011_MEANING[code] || `UNKNOWN_1011_${code}`;
}
