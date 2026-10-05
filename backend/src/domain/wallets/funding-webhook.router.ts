import crypto from 'crypto';
import { Router } from 'express';
import { walletCardService } from './wallet-card.service';

const router = Router();

router.post('/funding', async (req, res) => {
  try {
    const secret = process.env.FUNDING_WEBHOOK_SECRET?.trim();
    const signature = String(req.header('X-Funding-Signature') || '').trim().toLowerCase();
    if (!secret || !signature) {
      return res.status(401).json({ error: 'Funding webhook authentication is not configured' });
    }

    const payload = JSON.stringify(req.body || {});
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const receivedBuffer = Buffer.from(signature, 'utf8');
    if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
      return res.status(401).json({ error: 'Invalid funding webhook signature' });
    }

    const body = req.body || {};
    if (String(body.status || '').toUpperCase() !== 'SETTLED') {
      return res.status(202).json({ accepted: false, status: body.status || 'UNKNOWN' });
    }

    const result = await walletCardService.loadWalletOnline({
      psp: String(body.psp || ''),
      externalRef: String(body.externalRef || ''),
      customerId: String(body.customerId || ''),
      cardId: String(body.cardId || ''),
      amountMinor: Number(body.amountMinor),
      currency: String(body.currency || ''),
      idempotencyKey: String(body.idempotencyKey || `PSP-LOAD-${body.externalRef || ''}`),
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error: any) {
    console.error('[Funding webhook] rejected:', error?.message || error);
    return res.status(400).json({ error: error?.message || 'Unable to apply funding load' });
  }
});

export default router;
