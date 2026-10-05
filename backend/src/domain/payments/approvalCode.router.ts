/**
 * Approval Code Router â€” /api/approval-code
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * All routes require authenticateToken (mounted after it in app.ts).
 *
 * POST /api/approval-code/generate     â€” generate a new approval code
 * POST /api/approval-code/validate     â€” validate an existing approval code
 * POST /api/approval-code/voice-auth   â€” full 101.1 voice auth (ISO 8583 + code)
 * GET  /api/approval-code/test         â€” return 3 sample approval codes
 */

import { Router, Request, Response } from 'express';
import {
  generateApprovalCode,
  validateApprovalCode,
  generateSTAN,
  getIssuerSecret,
} from './approvalCode.service';
import { buildVoiceAuthRequest } from './iso8583.service';

export const approvalCodeRouter = Router();

// â”€â”€ POST /generate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
approvalCodeRouter.post('/generate', async (req: Request, res: Response) => {
  try {
    const {
      pan,
      amountMinor,
      stan: inStan,
      currency = 'USD',
      terminalId = 'TERM0001',
      merchantId = 'MERCHANT000001',
    } = req.body || {};

    if (!pan || amountMinor === undefined) {
      return res.status(400).json({ error: 'pan and amountMinor are required' });
    }

    const panStr = String(pan).replace(/\s+/g, '');
    if (panStr.length < 4) {
      return res.status(400).json({ error: 'pan must be at least 4 digits' });
    }

    const amount = Number(amountMinor);
    if (isNaN(amount) || amount < 0) {
      return res.status(400).json({ error: 'amountMinor must be a non-negative number' });
    }

    const result = await buildVoiceAuthRequest({
      pan: panStr,
      amountMinor: amount,
      currency: String(currency),
      terminalId: String(terminalId),
      merchantId: String(merchantId),
      stan: inStan ? String(inStan) : undefined,
    });

    const panLast4 = panStr.slice(-4);

    return res.json({
      approvalCode: result.approvalCode,
      stan: result.stan,
      rrn: result.rrn,
      datetimeIso: result.datetimeIso,
      iso8583: result.iso8583Message,
      panLast4,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
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
approvalCodeRouter.post('/voice-auth', async (req: Request, res: Response) => {
  try {
    const {
      pan,
      amountMinor,
      currency = 'USD',
      terminalId = 'TERM0001',
      merchantId = 'MERCHANT000001',
      stan: inStan,
    } = req.body || {};

    if (!pan || amountMinor === undefined || !currency) {
      return res.status(400).json({ error: 'pan, amountMinor, and currency are required' });
    }

    const panStr = String(pan).replace(/\s+/g, '');
    if (panStr.length < 4) {
      return res.status(400).json({ error: 'pan must be at least 4 digits' });
    }

    const amount = Number(amountMinor);
    if (isNaN(amount) || amount < 0) {
      return res.status(400).json({ error: 'amountMinor must be a non-negative number' });
    }

    const result = await buildVoiceAuthRequest({
      pan: panStr,
      amountMinor: amount,
      currency: String(currency),
      terminalId: String(terminalId),
      merchantId: String(merchantId),
      stan: inStan ? String(inStan) : undefined,
    });

    return res.json({
      ...result,
      valid: true,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
});

// â”€â”€ GET /test â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
approvalCodeRouter.get('/test', (_req: Request, res: Response) => {
  try {
    const issuerSecret = getIssuerSecret();
    const now = new Date().toISOString();

    const samples = [
      { panLast4: '1234', amountMinor: 10000, stan: generateSTAN() },
      { panLast4: '5678', amountMinor: 25099, stan: generateSTAN() },
      { panLast4: '9012', amountMinor: 500,   stan: generateSTAN() },
    ].map(s => ({
      panLast4:     s.panLast4,
      amountMinor:  s.amountMinor,
      stan:         s.stan,
      datetimeIso:  now,
      approvalCode: generateApprovalCode({
        panLast4:    s.panLast4,
        amountMinor: s.amountMinor,
        stan:        s.stan,
        datetimeIso: now,
        issuerSecret,
      }),
    }));

    return res.json({
      description: 'Sample approval codes for testing (101.1 voice auth)',
      samples,
      issuerSecretConfigured: !!process.env.ISSUER_SECRET_KEY,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
});
