import { Router, Request, Response } from 'express';
import { payoutsService, CreatePayoutInput, PayoutStatus } from './payouts.service';
import { authenticateToken } from '../../middleware/auth.middleware';
import { payoutIdempotency } from '../../middleware/idempotency.middleware';
import { v4 as uuidv4 } from 'uuid';
import { vaultPayoutEngine } from './vaultPayoutEngine';

const router = Router();

function standardError(res: Response, status: number, code: string, message: string, details?: Record<string, any>) {
  return res.status(status).json({
    error: code,
    message,
    code,
    details: details || {},
  });
}

async function patchPayoutStatus(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { status, external_reference, externalReference, error_code, errorCode, error_message, errorMessage } = req.body || {};
    const target = String(status || '').toUpperCase() as PayoutStatus;

    if (target === 'CONFIRMED') {
      return res.json(buildStatusResponse(await payoutsService.markConfirmed(id, external_reference || externalReference)));
    }
    if (target === 'FAILED') {
      return res.json(buildStatusResponse(await payoutsService.failPayout(id, error_code || errorCode, error_message || errorMessage)));
    }
    if (target === 'EXECUTING' || target === 'SENT') {
      return res.json(buildStatusResponse(await payoutsService.executePayout(id)));
    }
    return standardError(res, 400, 'INVALID_STATUS',
      `Unsupported status patch: ${target}. Use one of CONFIRMED, FAILED, EXECUTING, SENT.`,
      { supported_statuses: ['EXECUTING', 'SENT', 'CONFIRMED', 'FAILED'] });
  } catch (e: any) {
    const code = e?.code || e?.error || 'INTERNAL_ERROR';
    return standardError(res, code === 'PAYOUT_NOT_FOUND' ? 404 : 400, code, e?.message || String(e), e?.details || {});
  }
}

function buildCreatedResponse(payout: any) {
  return {
    id: payout.id,
    status: payout.status,
    source_account_id: payout.source_account_id,
    amount: Number(payout.amount),
    currency: payout.currency,
    channel: payout.channel,
    internal_reference: payout.internal_reference,
    uetr: payout.uetr,
    created_at: payout.created_at,
    merchant_id: payout.merchant_id,
    purpose: payout.purpose,
    metadata: payout.metadata || {},
    linked_ledger_transaction_id: payout.linked_ledger_transaction_id,
    destination_type: payout.destination_type,
  };
}

function buildStatusResponse(payout: any) {
  return {
    id: payout.id,
    status: payout.status,
    channel: payout.channel,
    uetr: payout.uetr,
    internal_reference: payout.internal_reference,
    amount: Number(payout.amount),
    currency: payout.currency,
    source_account_id: payout.source_account_id,
    external_reference: payout.external_reference,
    sent_at: payout.sent_at,
    confirmed_at: payout.confirmed_at,
    failed_at: payout.failed_at,
    error_code: payout.error_code,
    error_message: payout.error_message,
    payload_format: payout.payload_format,
    metadata: payout.metadata || {},
    merchant_id: payout.merchant_id,
    purpose: payout.purpose,
    destination_bank: payout.destination_bank
      ? {
          swift_bic: payout.destination_bank.swift_bic,
          account_number: payout.destination_bank.account_number,
          iban: payout.destination_bank.iban,
          account_name: payout.destination_bank.account_name,
          bank_name: payout.destination_bank.bank_name,
          country: payout.destination_bank.country,
        }
      : undefined,
    linked_ledger_transaction_id: payout.linked_ledger_transaction_id,
    linked_vault_transfer_id: payout.linked_vault_transfer_id,
    created_at: payout.created_at,
  };
}

router.post('/', authenticateToken, payoutIdempotency({ require: true }), async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const {
      source_account_id,
      destination_type,
      destination_bank,
      beneficiary_id,
      amount,
      currency,
      purpose,
      internal_reference,
      channel,
      merchant_id,
      metadata,
    } = body;

    const input: CreatePayoutInput = {
      source_account_id,
      destination_type: destination_type || 'bank',
      destination_bank: destination_bank
        ? {
            ...destination_bank,
            swift_bic: destination_bank.swift_bic || destination_bank.swift,
            account_number: destination_bank.account_number || destination_bank.accountNumber,
            account_name: destination_bank.account_name || destination_bank.accountName,
          }
        : undefined,
      beneficiary_id: beneficiary_id || undefined,
      amount: Number(amount),
      currency: String(currency || 'USD').toUpperCase(),
      purpose: purpose || undefined,
      internal_reference: internal_reference || `PAYOUT-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`,
      channel: (channel || 'MT103') as any,
      merchant_id: merchant_id || body.merchantId || (metadata && typeof metadata === 'object' && metadata.merchant_id) || undefined,
      metadata: metadata || undefined,
    };

    const result = await payoutsService.createPayout(input);

    try {
      const idemState = (req as any).idempotency;
      if (idemState?.enabled && typeof idemState.store === 'function') {
        await idemState.store(result.payout.id, { status: 201, body: buildCreatedResponse(result.payout) });
      }
    } catch (_) { /* idempotency best-effort */ }

    return res.status(201).json(buildCreatedResponse(result.payout));
  } catch (e: any) {
    const code = e?.code || e?.error || 'INTERNAL_ERROR';
    const status = (
      code === 'VALIDATION_ERROR' || code === 'NO_FUNDS' || code === 'ACCOUNT_NOT_FOUND'
      || code === 'BENE_INVALID' || code === 'CHANNEL_UNSUPPORTED' || code === 'IDEMPOTENCY_CONFLICT'
    ) ? 400 : 500;
    return standardError(res, status, code, e?.message || String(e), e?.details || {});
  }
});

router.get('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const payout = await payoutsService.getPayout(id);
    if (!payout) {
      return standardError(res, 404, 'PAYOUT_NOT_FOUND', `Payout ${id} not found`, { payout_id: id });
    }
    return res.json(buildStatusResponse(payout));
  } catch (e: any) {
    return standardError(res, 500, 'INTERNAL_ERROR', e?.message || String(e));
  }
});

router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      status, channel, merchant_id, merchantId,
      search, source_account_id, sourceAccountId,
      internal_reference, internalReference,
      uetr, limit, offset,
    } = req.query as any;

    const result = await payoutsService.listPayouts({
      status: status as any,
      channel: channel as any,
      merchant_id: merchant_id || merchantId,
      search: search ? String(search) : undefined,
      source_account_id: source_account_id || sourceAccountId,
      internal_reference: internal_reference || internalReference,
      uetr: uetr ? String(uetr).toUpperCase() : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });

    return res.json({
      count: result.count,
      limit: Number(limit || 500),
      offset: Number(offset || 0),
      payouts: result.rows.map(buildStatusResponse),
    });
  } catch (e: any) {
    return standardError(res, 500, 'INTERNAL_ERROR', e?.message || String(e));
  }
});

router.post('/:id/execute', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    return res.json(await vaultPayoutEngine.executePayout(id));
  } catch (e: any) {
    const code = e?.code || e?.error || 'INTERNAL_ERROR';
    const status = code === 'PAYOUT_NOT_FOUND' ? 404
      : code === 'CHANNEL_UNSUPPORTED' ? 400
      : code === 'LIQUIDITY_CRITICAL' || code === 'PAYOUT_INVALID_STATE' ? 409
      : code === 'PAYOUT_PROVIDER_FAILED' ? 502 : 500;
    return standardError(res, status, code, e?.message || String(e), e?.details || {});
  }
});

router.patch('/:id', authenticateToken, patchPayoutStatus);
router.patch('/:id/status', authenticateToken, patchPayoutStatus);

router.get('/:id/payload', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const payout = await payoutsService.getPayout(id);
    if (!payout) return standardError(res, 404, 'PAYOUT_NOT_FOUND', `Payout ${id} not found`, { payout_id: id });
    if (!payout.generated_payload) {
      return res.json({
        id,
        status: payout.status,
        payload_format: null,
        generated_payload: null,
        note: 'Payload not generated yet. Call POST /payouts/:id/execute first, or set channel=MT103/SEPA on create.',
      });
    }
    const fmt = payout.payload_format || 'TEXT';
    const acceptText = (req.headers.accept || '').includes('text/plain') || (req.query.raw === '1');
    if (acceptText) {
      const ext = fmt.includes('XML') ? 'xml' : fmt.includes('JSON') ? 'json' : 'txt';
      const ctype = fmt.includes('XML') ? 'application/xml'
        : fmt.includes('JSON') ? 'application/json' : 'text/plain; charset=utf-8';
      const safeRef = (payout.internal_reference || id).replace(/[^A-Z0-9-_]/gi, '_').slice(0, 40);
      res.setHeader('Content-Type', ctype);
      res.setHeader('Content-Disposition', `attachment; filename="${safeRef}_${fmt}.${ext}"`);
      return res.send(payout.generated_payload);
    }
    return res.json({
      id,
      status: payout.status,
      uetr: payout.uetr,
      payload_format: fmt,
      internal_reference: payout.internal_reference,
      generated_payload: payout.generated_payload,
    });
  } catch (e: any) {
    return standardError(res, 500, 'INTERNAL_ERROR', e?.message || String(e));
  }
});

export { router as payoutsRouter };
export default router;
