import { Router, Request, Response } from "express";
import { IssuerProcessor } from "./issuerProcessor";
import { IssuerEmvValidator } from '../services/hsm/issuerEmvValidator';
import { getHsmClient } from '../services/hsm/hsmClientImpl';

export const issuerProcessorRouter = Router();

function handle(operation: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      return res.json(await operation(req));
    } catch (error: any) {
      const clientErrors = new Set([
        "CUSTOMER_REQUIRED", "TOKEN_REQUIRED", "MERCHANT_REQUIRED", "MERCHANT_ACCOUNT_REQUIRED",
        "AUTH_REF_REQUIRED", "CAPTURE_REF_REQUIRED", "REASON_CODE_REQUIRED", "INVALID_AMOUNT",
        "INVALID_CURRENCY", "ISSUER_ACCOUNT_NOT_FOUND", "INSUFFICIENT_FUNDS",
        "CARD_TOKEN_NOT_FOUND", "AUTH_NOT_FOUND", "AUTH_ALREADY_USED", "CAPTURE_EXCEEDS_AUTH",
        "EMV_FIELD55_INVALID_HEX", "EMV_TLV_TRUNCATED_TAG", "EMV_TLV_TRUNCATED_LENGTH",
        "EMV_TLV_INVALID_LENGTH", "EMV_TLV_VALUE_TRUNCATED_AT_5A", "EMV_TLV_VALUE_TRUNCATED_AT_5F24",
        "EMV_TLV_VALUE_TRUNCATED_AT_9F26", "EMV_TLV_VALUE_TRUNCATED_AT_9F10",
        "EMV_TLV_VALUE_TRUNCATED_AT_95", "EMV_TLV_VALUE_TRUNCATED_AT_9B",
        "EMV_TLV_VALUE_TRUNCATED_AT_82", "EMV_CRYPTOGRAM_INVALID", "EMV_RISK_DECLINED",
        "EMV_PAN_MISMATCH", "EMV_AMOUNT_MISMATCH", "EMV_CURRENCY_MISMATCH",
        "ISO_AMOUNT_MISMATCH", "ISO_CURRENCY_MISMATCH", "EMV_ATC_REPLAY",
        "ISO_MTI_MUST_BE_0200", "ISO_AMOUNT_INVALID", "ISO_CURRENCY_INVALID",
        "ISO_CURRENCY_UNSUPPORTED", "EMV_FIELD55_REQUIRED",
      ]);
      const status = clientErrors.has(error.message) || String(error.message || "").startsWith("EMV_") ? 400 : 500;
      return res.status(status).json({ error: error.message || "ISSUER_PROCESSING_ERROR" });
    }
  };
}

issuerProcessorRouter.post("/authorize", handle((req) => IssuerProcessor.authorize(req.body)));
issuerProcessorRouter.post("/authorize-emv", handle((req) => IssuerProcessor.authorizeEmv(req.body)));
issuerProcessorRouter.post("/authorize-iso", handle((req) => IssuerProcessor.authorizeIso(req.body)));
issuerProcessorRouter.post("/capture", handle((req) => IssuerProcessor.capture(req.body)));
issuerProcessorRouter.post("/refund", handle((req) => IssuerProcessor.refund(req.body)));
issuerProcessorRouter.post("/chargeback", handle((req) => IssuerProcessor.chargeback(req.body)));

// POST /api/issuer/emv/validate — validate EMV ARQC from Field 55
issuerProcessorRouter.post('/emv/validate', async (req: Request, res: Response) => {
  try {
    const { field55Hex, pan, expiryYYMM, amountMinor, currencyNumeric } = req.body || {};
    if (!field55Hex || !pan || !expiryYYMM || !amountMinor) {
      return res.status(400).json({ error: 'field55Hex, pan, expiryYYMM, amountMinor required' });
    }
    const validator = new IssuerEmvValidator(getHsmClient());
    const result = await validator.validate(
      String(field55Hex),
      String(pan),
      String(expiryYYMM),
      Number(amountMinor),
      String(currencyNumeric || '840'),
    );
    return res.json({ ok: true, arc: result.arc, scripts: result.scripts.map(s => s.toString('hex')), valid: result.arc === '00' });
  } catch (e: any) {
    const arc = e.message?.match(/ARC_(\w+)/)?.[1] || '05';
    return res.status(400).json({ ok: false, arc, error: e.message });
  }
});

// POST /api/issuer/emv/authorize-iso8583 — full ISO 8583 EMV authorization from Android POS
issuerProcessorRouter.post('/emv/authorize-iso8583', async (req: Request, res: Response) => {
  try {
    const {
      pan, amountMinor, currency, expiry,
      field55Hex, atcHex, arqcHex,
      merchantId, terminalId, entryMode,
    } = req.body || {};

    if (!pan || !amountMinor || !field55Hex) {
      return res.status(400).json({ error: 'pan, amountMinor, field55Hex required' });
    }

    // 1. Validate ARQC via HSM
    const { IssuerEmvValidator } = await import('../services/hsm/issuerEmvValidator');
    const { getHsmClient }       = await import('../services/hsm/hsmClientImpl');
    const validator = new IssuerEmvValidator(getHsmClient());
    const expiryYYMM = String(expiry || '3012').replace('/', '');
    const currencyNum = String(currency || '840');

    let arc = '05';
    let scripts: string[] = [];
    let emvValid = false;

    try {
      const emvResult = await validator.validate(
        String(field55Hex), String(pan), expiryYYMM, Number(amountMinor), currencyNum
      );
      arc      = emvResult.arc;
      scripts  = emvResult.scripts.map(s => s.toString('hex'));
      emvValid = arc === '00';
    } catch (emvErr: any) {
      arc = emvErr.message?.match(/ARC_(\w+)/)?.[1] || '05';
      return res.status(200).json({ approved: false, arc, approvalCode: '', error: emvErr.message });
    }

    if (!emvValid) {
      return res.status(200).json({ approved: false, arc, approvalCode: '', error: `EMV declined ARC=${arc}` });
    }

    // 2. Credit merchant wallet + vault via internal processor
    const { confirmInternalCapture } = await import('../domain/payments/internalProcessor.service');
    const { vaultEngine }            = await import('../domain/vault/vault.service');
    const { db: issuerDb }           = await import('../config/db');
    const { v4: iuuid }              = await import('uuid');

    const amount      = Number(amountMinor) / 100;
    const ccy         = currency === '978' ? 'EUR' : currency === '826' ? 'GBP' : 'USD';
    const authRef     = `EMV-${Date.now().toString(36).toUpperCase()}-${(atcHex || '').slice(-4)}`;
    const approvalCode = authRef.slice(0, 8);

    await confirmInternalCapture({
      merchantId:    String(merchantId || 'MRC-1001'),
      amount,
      currency:      ccy,
      authRef,
      transactionId: authRef,
      protocol:      '101.6',
      panMasked:     `****${String(pan).slice(-4)}`,
    });

    try {
      await vaultEngine.creditVault({
        amount, currency: ccy, reference: authRef,
        merchantId: String(merchantId || 'MRC-1001'),
        type: 'CARD_CAPTURE',
        meta: { source: 'emv_nfc_tap', pan_last4: String(pan).slice(-4), arqc: arqcHex },
      });
    } catch { /* non-critical */ }

    try {
      let custId1016: string | null = null;
      const panMasked1016 = `****${String(pan).slice(-4)}`;
      const ccWhere: string[] = [];
      const ccParams: any[] = [];
      if (approvalCode) { ccWhere.push('code = ?'); ccParams.push(approvalCode); }
      ccWhere.push('(pan_masked = ? OR card_number LIKE ? OR card_number = ?)');
      ccParams.push(panMasked1016, `%${String(pan).slice(-8) || String(pan).slice(-4)}%`, panMasked1016);
      if (merchantId) { ccWhere.push('merchant_id = ?'); ccParams.push(String(merchantId || 'MRC-1001')); }
      const ccRes = await issuerDb.query(
        `SELECT customer_id FROM card_authorizations WHERE ${ccWhere.join(' AND ')} AND customer_id IS NOT NULL ORDER BY captured_at DESC, created_at DESC LIMIT 1`,
        ccParams
      );
      if (ccRes.rows?.[0]?.customer_id) custId1016 = String(ccRes.rows[0].customer_id);
      if (custId1016) {
        const { fundsSettlementService } = await import('../domain/settlements/funds-settlement.service');
        await fundsSettlementService.creditCustomerWallet({
          customer_id: custId1016,
          amount,
          currency: ccy,
          source: 'emv_101.6_customer_credit',
          reference: authRef,
          initiated_by: 'issuer_emv_101.6'
        });
      }
    } catch (custErr1016: any) {
      console.warn('[issuerProcessor | 101.6] customer wallet credit skipped (non-fatal):', custErr1016?.message);
    }

    // 3. Log transaction
    const posId   = iuuid();
    const batchId = `batch-emv-${posId.slice(0, 8)}`;
    await issuerDb.query(
      `INSERT OR IGNORE INTO pos2013_transactions
        (id, merchant_id, terminal_id, batch_id, local_txn_id, stan,
         amount_minor, currency, pan_masked, txn_type, auth_mode, entry_mode, auth_code, status, txn_timestamp)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [posId, merchantId || 'MRC-1001', terminalId || 'T2013-001', batchId, posId,
       atcHex || '0001', Number(amountMinor), ccy,
       `****${String(pan).slice(-4)}`, 'PURCHASE', 'EMV_CHIP_NFC',
       entryMode || 'CHIP_NFC', approvalCode, 'APPROVED', new Date().toISOString()]
    );

    return res.json({
      approved:     true,
      arc:          '00',
      approvalCode,
      field55Hex:   null,  // issuer scripts — empty until real HSM provides them
      scripts,
    });
  } catch (e: any) {
    return res.status(500).json({ approved: false, arc: '96', error: e.message });
  }
});
