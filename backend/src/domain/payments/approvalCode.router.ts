/**
 * Approval Code Router â€” /api/approval-code
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * All routes require authenticateToken (mounted after it in app.ts).
 *
 * POST /api/approval-code/validate     â€” validate an existing approval code
 *
 * LOCKED (approval codes are never minted on request):
 * POST /api/approval-code/generate     â€” 403 APPROVAL_CODE_GENERATION_DISABLED
 * POST /api/approval-code/voice-auth   â€” 403 APPROVAL_CODE_GENERATION_DISABLED
 * GET  /api/approval-code/test         â€” 403 APPROVAL_CODE_GENERATION_DISABLED
 *
 * Reason: an approval code is only meaningful when it comes back from a real
 * authorization (a scheme/acquirer response code 00, or a fund-verified inbound
 * registration). A code generated locally from ISSUER_SECRET_KEY approved
 * transactions with no funds behind them.
 */

import { Router, Request, Response } from 'express';
import {
  validateApprovalCode,
  getIssuerSecret,
} from './approvalCode.service';

export const approvalCodeRouter = Router();

// â”€â”€ POST /generate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// âš ï¸ LOCKED under the real-capture gate. Generating an approval code here means
// approving a transaction that no acquirer ever authorized.
approvalCodeRouter.post('/generate', (_req: Request, res: Response) => {
  return res.status(403).json({
    error: 'APPROVAL_CODE_GENERATION_DISABLED',
    message:
      'Approval codes cannot be generated on request. A code is only valid when it comes from a live authorization (acquirer/scheme response code 00) or a fund-verified inbound registration.',
  });
});

// â”€â”€ POST /validate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
approvalCodeRouter.post('/validate', async (req: Request, res: Response) => {
  try {
    const { panLast4, amountMinor, stan, datetimeIso, approvalCode } = req.body || {};

    if (!panLast4 || amountMinor === undefined || !stan || !datetimeIso || !approvalCode) {
      return res.status(400).json({
        error: 'panLast4, amountMinor, stan, datetimeIso, and approvalCode are all required',
      });
    }

    const amount = Number(amountMinor);
    if (isNaN(amount)) {
      return res.status(400).json({ error: 'amountMinor must be a number' });
    }

    const issuerSecret = getIssuerSecret();
    const valid = validateApprovalCode({
      panLast4: String(panLast4),
      amountMinor: amount,
      stan: String(stan),
      datetimeIso: String(datetimeIso),
      issuerSecret,
      approvalCode: String(approvalCode),
    });

    if (valid) {
      return res.json({ valid: true });
    } else {
      return res.status(200).json({
        valid: false,
        reason: 'Approval code does not match the provided transaction parameters',
      });
    }
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
});

// â”€â”€ POST /voice-auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// âš ï¸ LOCKED under the real-capture gate. A 101.1 voice authorization code is
// given verbally by the issuing bank and typed in by the merchant — the
// processor must never mint one. Use POST /api/payments/charge with the
// bank-supplied authCode instead; it is validated against the inbound
// registration before anything is approved.
approvalCodeRouter.post('/voice-auth', (_req: Request, res: Response) => {
  return res.status(403).json({
    error: 'APPROVAL_CODE_GENERATION_DISABLED',
    message:
      'The processor does not issue voice authorization codes. Submit the code your bank gave you to POST /api/payments/charge as "authCode" (protocol 101.1).',
  });
});

// â”€â”€ GET /test â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// âš ï¸ LOCKED under the real-capture gate — sample codes were minted from
// ISSUER_SECRET_KEY and could be replayed as if a real issuer had approved them.
approvalCodeRouter.get('/test', (_req: Request, res: Response) => {
  return res.status(403).json({
    error: 'APPROVAL_CODE_GENERATION_DISABLED',
    message: 'Sample approval codes are disabled. Approval codes only come from a live authorization.',
  });
});
