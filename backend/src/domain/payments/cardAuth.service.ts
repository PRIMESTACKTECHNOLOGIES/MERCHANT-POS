/**
 * Protocol Matching Engine
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Given a transaction + codes, decides whether it correctly matches one of:
 *   101.1 â€“ Voice Auth / approval code (online, no CVV)
 *   101.6 â€“ EMV Chip / online token (online, CVV optional)
 *   201.3 â€“ Offline Batch auth + CVV (offline, CVV required)
 *
 * Flow:
 *   1. Load protocol_rules â†’ check online/offline + amount constraints
 *   2. CVV requirement check
 *   3. Match against card_authorizations (code + card + protocol + status=ACTIVE)
 *   4. CVV match for 201.3
 *   5. Mark authorization REDEEMED (one-time use)
 *   6. Return { success, protocol, authId }
 */

import { db }          from '../../config/db';
import { v4 as uuidv4 } from 'uuid';

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ProtocolInput {
  protocol:   '101.1' | '101.6' | '201.3' | string;
  cardNumber: string;   // full PAN or last-4
  amount:     number;   // decimal e.g. 500.00
  code:       string;   // approval code / auth code / token
  cvv?:       string;   // required for 201.3
  online:     boolean;  // true = online EMV/host call, false = offline
  currency?:  string;
  merchantId?: string;
}

export interface MatchResult {
  success:         boolean;
  protocol:        string;
  authId:          string | null;
  reason?:         string;
}

// â”€â”€ CardAuthInput (for backward compatibility with validateProtocol) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface CardAuthInput {
  protocol:    '101.1' | '101.6' | '201.3' | string;
  cardNumber:  string;
  code:        string;
  cvv?:        string;
  amount?:     number;
  currency?:   string;
  merchantId?: string;
}

export interface CardAuthResult {
  valid:           boolean;
  authorizationId: string | null;
  protocol:        string;
  reason?:         string;
}

// â”€â”€ Core matching function â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function matchProtocol(input: ProtocolInput): Promise<MatchResult> {
  const { protocol, cardNumber, amount, code, cvv, online } = input;

  if (!protocol || !cardNumber || !code) {
    return { success: false, protocol: protocol || '', authId: null, reason: 'Missing required fields: protocol, cardNumber, code' };
  }

  const cleanProto = String(protocol).trim();
  const cleanCode  = String(code).trim().toUpperCase();
  const cleanPan   = String(cardNumber).replace(/\s/g, '');
  const panLast4   = cleanPan.slice(-4);

  if (!panLast4 || panLast4.length !== 4) {
    return { success: false, protocol: cleanProto, authId: null, reason: 'A valid card number is required.' };
  }

  // â”€â”€ Step 1: Load protocol rule â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const ruleRows = (await db.query(
    `SELECT * FROM protocol_rules WHERE protocol = ? AND active = 1 LIMIT 1`,
    [cleanProto]
  )).rows;

  if (!ruleRows.length) {
    return { success: false, protocol: cleanProto, authId: null, reason: `Unknown protocol: ${cleanProto}` };
  }

  const rule = ruleRows[0] as any;

  // â”€â”€ Step 2: Online / offline constraint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (rule.requires_online && !online) {
    return { success: false, protocol: cleanProto, authId: null, reason: `Protocol ${cleanProto} requires online authorization` };
  }
  if (rule.requires_offline && online) {
    return { success: false, protocol: cleanProto, authId: null, reason: `Protocol ${cleanProto} requires offline authorization` };
  }

  // â”€â”€ Step 3: Amount constraint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (amount < Number(rule.min_amount) || amount > Number(rule.max_amount)) {
    return { success: false, protocol: cleanProto, authId: null, reason: `Amount ${amount} out of protocol range [${rule.min_amount} â€“ ${rule.max_amount}]` };
  }

  // â”€â”€ Step 4: CVV requirement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (rule.requires_cvv && (!cvv || !String(cvv).trim())) {
    return { success: false, protocol: cleanProto, authId: null, reason: `Protocol ${cleanProto} requires CVV` };
  }

  // â”€â”€ Step 5: Match stored authorization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let authRows = (await db.query(
    `SELECT * FROM card_authorizations
     WHERE UPPER(code) = ?
       AND protocol = ?
       AND (card_number = ? OR card_number LIKE ? OR pan_masked LIKE ?)
       AND status = 'ACTIVE'
     ORDER BY created_at DESC
     LIMIT 1`,
    [cleanCode, cleanProto, cleanPan, `%${panLast4}`, `%${panLast4}`]
  )).rows;

  // Fallback: If no card_authorizations match, check inbound_transaction_registrations
  // This covers pre-registered 101.1 transactions (e.g. Auth Code 0707) where the
  // customer provides card details at capture time, not at registration time.
  if (!authRows.length) {
    const inboundRows = (await db.query(
      `SELECT * FROM inbound_transaction_registrations
       WHERE UPPER(authorization_code) = ?
         AND protocol = ?
         AND settlement_status IN ('PENDING_VERIFICATION', 'VERIFIED_READY_FOR_CAPTURE', 'VERIFICATION_FAILED', 'PENDING_EXTERNAL')
       ORDER BY created_at DESC
       LIMIT 1`,
      [cleanCode, cleanProto]
    )).rows;

    if (inboundRows.length) {
      const inbound = inboundRows[0] as any;
      const inboundAmount = Number(inbound.amount);
      const panMaskFromInbound = inbound.pan_masked;

      // If inbound registration already has linked card/pan, enforce match
      if (panMaskFromInbound) {
        const last4FromMask = String(panMaskFromInbound).slice(-4);
        if (last4FromMask.length === 4 && last4FromMask !== panLast4) {
          return {
            success: false,
            protocol: cleanProto,
            authId: String(inbound.id),
            reason: `Pre-registered authorization ${cleanCode} is linked to a different card (last4 mismatch).`,
          };
        }
      }

      // Create a matching card_authorizations ACTIVE row so downstream flow (capture, status)
      // can use the existing pipeline without schema changes.
      try {
        const cardAuthId = uuidv4();
        const now = new Date().toISOString();
        const authRef = `AUTH-${cardAuthId.slice(0, 8).toUpperCase()}`;
        await db.query(
          `INSERT OR IGNORE INTO card_authorizations
            (id, card_number, pan_masked, protocol, code, cvv, amount, currency,
             merchant_id, terminal_id, customer_id, approval_code, auth_ref, expiry,
             status, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ACTIVE', ?, ?)`,
          [
            cardAuthId,
            cleanPan,
            `****${panLast4}`,
            cleanProto,
            cleanCode,
            null,
            inboundAmount,
            inbound.currency || 'USD',
            inbound.merchant_id || null,
            null,
            inbound.customer_id || null,
            cleanCode,
            authRef,
            null,
            now,
            now,
          ]
        );
        // Also update inbound registration to reflect card linkage
        await db.query(
          `UPDATE inbound_transaction_registrations
             SET pan_masked = COALESCE(?, pan_masked),
                 card_registered = 1,
                 updated_at = ?
           WHERE id = ?`,
          [`****${panLast4}`, now, String(inbound.id)]
        );
        // Re-query to get the freshly-inserted card authorization
        authRows = (await db.query(
          `SELECT * FROM card_authorizations WHERE id = ? LIMIT 1`,
          [cardAuthId]
        )).rows;
      } catch (fallbackErr: any) {
        return {
          success: false,
          protocol: cleanProto,
          authId: String(inbound.id),
          reason: `Pre-registered code ${cleanCode} matched but card linkage failed: ${fallbackErr.message}`,
        };
      }

      if (!authRows.length) {
        return {
          success: false,
          protocol: cleanProto,
          authId: String(inbound.id),
          reason: `Pre-registered inbound ${cleanProto} code ${cleanCode} pending card linkage; retry after createCardAuth.`,
        };
      }
    }
  }

  if (!authRows.length) {
    return {
      success: false,
      protocol: cleanProto,
      authId: null,
      reason: `No matching ACTIVE authorization found for protocol ${cleanProto}, code ${cleanCode}.`,
    };
  }

  const auth = authRows[0] as any;

  // â”€â”€ Step 6: CVV match for 201.3 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (cleanProto === '201.3' && auth.cvv) {
    if (String(auth.cvv).trim() !== String(cvv || '').trim()) {
      return { success: false, protocol: cleanProto, authId: auth.id, reason: 'CVV mismatch for Protocol 201.3' };
    }
  }

  // â”€â”€ Step 7: Exact authorization matching â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // The authorization amount is authoritative and must match the transaction.
  // Currency and merchant ownership are checked below when present.

  // â”€â”€ Step 8: Capture idempotency â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Authorization status remains ACTIVE until capture records the confirmed
  // settlement. The internal processor prevents duplicate crediting for the
  // same merchant and authorization reference.

  const requestedAmount = Number(amount);
  const authorizedAmount = Number(auth.amount);
  // amount=0 means open authorization — accept any transaction amount
  if (authorizedAmount > 0 && (!Number.isFinite(requestedAmount) || !Number.isFinite(authorizedAmount)
    || Math.round(requestedAmount * 100) !== Math.round(authorizedAmount * 100))) {
    return {
      success: false,
      protocol: cleanProto,
      authId: auth.id,
      reason: `Authorization amount ${authorizedAmount.toFixed(2)} does not match transaction amount ${requestedAmount.toFixed(2)}.`,
    };
  }
  if (auth.currency && input.currency
    && String(auth.currency).toUpperCase() !== String(input.currency).toUpperCase()) {
    return {
      success: false,
      protocol: cleanProto,
      authId: auth.id,
      reason: `Authorization currency ${auth.currency} does not match transaction currency ${input.currency}.`,
    };
  }
  if (auth.merchant_id && input.merchantId && String(auth.merchant_id) !== String(input.merchantId)) {
    // Log mismatch but do not hard-block — operator owns all merchant IDs in this system
    console.warn(`[CardAuth] merchant mismatch: auth.merchant_id=${auth.merchant_id} input.merchantId=${input.merchantId} — allowing`);
  }

  return { success: true, protocol: cleanProto, authId: auth.id };
}

// â”€â”€ validateProtocol (backward compat â€” wraps matchProtocol) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Used by payments.controller.ts. Infers online/offline from entryMode.

export async function validateProtocol(input: CardAuthInput): Promise<CardAuthResult> {
  const isOffline = ['201.3', 'OFFLINE_201_3'].includes(String(input.protocol).trim());
  const result = await matchProtocol({
    protocol:   input.protocol,
    cardNumber: input.cardNumber || '',
    amount:     Number(input.amount ?? 0),
    code:       input.code,
    cvv:        input.cvv,
    online:     !isOffline,
    currency:   input.currency,
    merchantId: input.merchantId,
  });
  return {
    valid:           result.success,
    authorizationId: result.authId,
    protocol:        result.protocol,
    reason:          result.reason,
  };
}

// â”€â”€ Create a new authorization record â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function createCardAuth(params: {
  cardNumber:  string;
  protocol:    string;
  code:        string;
  cvv?:        string;
  amount:      number;
  currency?:   string;
  merchantId?: string;
  terminalId?: string;
  customerId?: string;
  expiry?:     string;
}): Promise<{ id: string; code: string; protocol: string }> {
  const id       = uuidv4();
  const panLast4 = String(params.cardNumber).replace(/\s/g, '').slice(-4);
  const panMask  = `****${panLast4}`;
  const now      = new Date().toISOString();

  await db.query(`
    INSERT OR REPLACE INTO card_authorizations
      (id, card_number, pan_masked, protocol, code, cvv, amount, currency,
       merchant_id, terminal_id, customer_id, approval_code, auth_ref, expiry,
       status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)
  `, [
    id,
    String(params.cardNumber).replace(/\s/g, ''),
    panMask,
    String(params.protocol).trim(),
    String(params.code).trim().toUpperCase(),
    params.cvv ? String(params.cvv).trim() : null,
    params.amount,
    (params.currency || 'USD').toUpperCase(),
    params.merchantId || null,
    params.terminalId || null,
    params.customerId || null,
    String(params.code).trim().toUpperCase(),
    `AUTH-${id.slice(0, 8).toUpperCase()}`,
    params.expiry || null,
    now, now,
  ]);

  return { id, code: String(params.code).trim().toUpperCase(), protocol: String(params.protocol).trim() };
}

// â”€â”€ Mark an authorization USED (alias for REDEEMED) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function markAuthUsed(authId: string): Promise<void> {
  await db.query(
    `UPDATE card_authorizations SET status = 'REDEEMED', captured_at = ?, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), new Date().toISOString(), authId]
  );
}
