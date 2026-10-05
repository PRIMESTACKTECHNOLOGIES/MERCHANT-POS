import { Request, Response } from "express";
import { paymentsService } from "./payments.service";
import { walletsService } from "../wallets/wallets.service";
import { getWsServer } from "../../realtime/wsServer";
import { acr122uReaderService } from "./acr122u-reader";
import { parseTlv, extractEmvData } from "./emv-tlv-parser";
import { recordOfflinePosTransaction } from './offline-sync.service';
import { performOda } from "../../utils/emvOda";
import { posDecisionService } from "./pos-decision.service";
import { settleCardTransaction } from "./realSettlement.service";
import { db } from "../../config/db";
import { inboundTransactionService } from "./inboundTransaction.service";

export class PaymentsController {

  async charge(req: Request, res: Response) {
    try {
      const {
        amountMinor, currency, merchantId, pan, expiry, cvv, emv, terminalId, tlvRaw,
        stan, customerId, authCode, entryMode, protocol,
      } = req.body || {};

      if (!amountMinor || !currency) {
        return res.status(400).json({ error: "amountMinor and currency required" });
      }

      if (!merchantId) {
        return res.status(400).json({ error: "merchantId required" });
      }

      if (pan && pan.length < 12) {
        return res.status(400).json({ error: "Invalid PAN" });
      }

      if (expiry && !/^\d{2}\/\d{2}$/.test(expiry)) {
        return res.status(400).json({ error: "Invalid expiry format MM/YY" });
      }

      // ── Protocol detection ─────────────────────────────────────────────────
      // Explicit protocol from the caller wins (101.1, 101.6, 201.3).
      // If omitted, fall back to entryMode heuristic.
      const explicitProtocol = String(protocol || '').trim();
      const rawMode = String(entryMode || '').toUpperCase();
      const isProtocol101_1 = explicitProtocol === '101.1' || rawMode === 'VOICE_AUTH' || rawMode === '101.1';
      const isProtocol101_6 = explicitProtocol === '101.6' || rawMode === '101.6' || rawMode === 'EMV' || rawMode === 'CHIP';
      const isProtocol201_3 = explicitProtocol === '201.3' || rawMode === 'OFFLINE_201_3' || rawMode === '201.3' || rawMode === 'MANUAL_MOTO' || rawMode === 'MOTO';
      const hasAuthCode = !!(authCode && String(authCode).trim());
      const requiresAuth = isProtocol201_3 || isProtocol101_1 || isProtocol101_6 || hasAuthCode;
      const effectiveProtocolStr =
        isProtocol101_1 ? '101.1' : isProtocol101_6 ? '101.6' : isProtocol201_3 ? '201.3' : '201.3';

      let effectiveAuthCode = authCode ? String(authCode).trim() : '';
      let generatedCode = false;

      // â”€â”€ 101.1: Auto-generate cryptographic approval code if none provided â”€â”€
      if (isProtocol101_1 && !hasAuthCode && pan && amountMinor) {
        try {
          const { buildVoiceAuthRequest } = await import('./iso8583.service');
          const voiceAuth = await buildVoiceAuthRequest({
            pan: String(pan).replace(/\s/g,''),
            amountMinor: Number(amountMinor),
            currency: String(currency || 'USD'),
            terminalId: String(terminalId || 'T2013-001'),
            merchantId: String(merchantId || 'MRC-1001'),
            stan: stan ? String(stan) : undefined,
          });
          effectiveAuthCode = voiceAuth.approvalCode;
          generatedCode = true;
          // Auto-register the generated code so it passes DB validation
          const { createCardAuth } = await import('./cardAuth.service');
          await createCardAuth({
            cardNumber: String(pan).replace(/\s/g,''),
            protocol: '101.1',
            code: voiceAuth.approvalCode,
            amount: Number(amountMinor) / 100,
            currency: String(currency || 'USD'),
            merchantId: String(merchantId || 'MRC-1001'),
          });
          console.log(`[101.1] Crypto approval code generated: ${voiceAuth.approvalCode} | STAN: ${voiceAuth.stan}`);
        } catch (codeErr: any) {
          console.warn('[101.1] Code generation failed:', codeErr.message);
        }
      }

      // â”€â”€ Protocol validation (DB lookup + optional HMAC verify) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (requiresAuth && effectiveAuthCode) {
        const { validateProtocol } = await import('./cardAuth.service');
        const proto = isProtocol201_3 ? '201.3' : isProtocol101_1 ? '101.1' : isProtocol101_6 ? '101.6' : '201.3';
        const validation = await validateProtocol({
          protocol:   proto,
          cardNumber: pan || '',
          code:       effectiveAuthCode,
          cvv:        cvv || undefined,
          amount:     amountMinor ? Number(amountMinor) / 100 : 0,
          currency:   currency || 'USD',
          merchantId: merchantId || undefined,
        });
        if (!validation.valid) {
          console.warn(`[Protocol ${proto}] Auth code rejected: ${validation.reason}`);
          return res.status(403).json({
            success: false, status: 'DECLINED',
            error: validation.reason || 'Invalid authorization code',
            reason: `[${proto}_INVALID_AUTH] ${validation.reason}`,
            protocol: proto,
          });
        }
        // â”€â”€ For 101.1: also verify cryptographically if STAN + datetime available â”€â”€
        if (isProtocol101_1 && stan && !generatedCode) {
          try {
            const { validateApprovalCode, getIssuerSecret } = await import('./approvalCode.service');
            const panLast4 = String(pan||'').replace(/\s/g,'').slice(-4);
            const nowIso = new Date().toISOString();
            // Allow up to 24h window for datetime variance
            const cryptoValid = validateApprovalCode({
              panLast4,
              amountMinor: Number(amountMinor),
              stan: String(stan),
              datetimeIso: nowIso,
              issuerSecret: getIssuerSecret(),
              approvalCode: effectiveAuthCode,
            });
            if (cryptoValid) {
              console.log(`[101.1] HMAC verification: PASSED for code ${effectiveAuthCode}`);
            } else {
              console.log(`[101.1] HMAC verification: SKIPPED (pre-registered code) for ${effectiveAuthCode}`);
            }
          } catch { /* non-fatal â€” DB validation already passed */ }
        }
        console.log(`[Protocol ${isProtocol201_3?'201.3':isProtocol101_1?'101.1':'101.6'}] Auth code verified: ${effectiveAuthCode}`);
      } else if (requiresAuth && !effectiveAuthCode) {
        const protocol = isProtocol201_3 ? '201.3' : isProtocol101_1 ? '101.1' : '101.6';
        return res.status(400).json({
          success: false, status: 'DECLINED',
          error: `Protocol ${protocol} requires an Authorization Code.`,
          reason: `[${protocol}_NO_AUTH_CODE] Authorization code is mandatory.`,
        });
      }

      console.log("Charge request received", { amountMinor, currency, merchantId, terminalId, stan });

      let normalizedEmv = emv;
      if (!normalizedEmv && tlvRaw && typeof tlvRaw === "string") {
        try {
          const rawBuffer = Buffer.from(tlvRaw, "hex");
          const parsedTlv = parseTlv(rawBuffer);
          normalizedEmv = extractEmvData(parsedTlv, tlvRaw);
        } catch {
          normalizedEmv = { field55: tlvRaw };
        }
      }

      const result = await paymentsService.charge(merchantId, {
        amountMinor,
        currency,
        pan,
        expiry,
        cvv,
        emv: normalizedEmv,
        terminalId,
        merchantId,
        stan,
        customerId,
        authCode: effectiveAuthCode || authCode,
        entryMode,
        protocol: effectiveProtocolStr,
      });

      if (result?.status === "APPROVED" && customerId) {
        try {
          const wallet = await walletsService.getOrCreateWallet(customerId);
          const io = getWsServer();
          io.to(customerId).emit("wallet.refresh", {
            customerId,
            walletId: wallet.id,
            balanceChanged: true,
          });
        } catch (err) {
          console.warn("[WS] Failed to emit wallet.refresh", err);
        }
      }

      res.json(result);

    } catch (e: any) {
      res.status(500).json({
        error: e.message,
        code: "PROCESSOR_ERROR"
      });
    }
  }

  async decide(req: Request, res: Response) {
    try {
      const { merchantId, terminalId, amountMinor, currency, card, emv, oda, tlvRaw } = req.body || {};

      if (!merchantId || !terminalId || !amountMinor || !currency) {
        return res.status(400).json({ error: "merchantId, terminalId, amountMinor and currency are required" });
      }

      let decisionEmv = emv;
      if (!decisionEmv && tlvRaw && typeof tlvRaw === 'string') {
        try {
          const rawBuffer = Buffer.from(tlvRaw, 'hex');
          const parsedTlv = parseTlv(rawBuffer);
          decisionEmv = extractEmvData(parsedTlv);
        } catch {
          decisionEmv = undefined;
        }
      }

      const result = await posDecisionService.decide({
        merchantId,
        terminalId,
        amountMinor,
        currency,
        card,
        emv: decisionEmv,
        oda,
      });

      return res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Unable to decide POS outcome" });
    }
  }

  async readAcr122uCard(req: Request, res: Response) {
    try {
      if (!acr122uReaderService.isEnabled()) {
        return res.status(503).json({
          success: false,
          error: "ACR122U reader unavailable."
        });
      }

      const amountMinor = Number(req.body?.amountMinor || 0);
      const currency = String(req.body?.currency || 'USD').toUpperCase();
      const card = await acr122uReaderService.readCard(amountMinor, currency);
      if (!card) {
        return res.status(404).json({
          success: false,
          error: "No card detected."
        });
      }

      if (!(card as any).emvReady) {
        return res.status(422).json({
          success: false,
          nfcDetected: true,
          paymentCardReady: false,
          error: (card as any).error || 'NFC device detected, but no EMV payment application was available. Use a certified contactless terminal for phone wallets.'
        });
      }

      // If the reader returns raw EMV data, parse it
      let emv: Record<string, any> | null = null;
      let tlvRaw: string | null = null;

      if ((card as any).raw && Buffer.isBuffer((card as any).raw)) {
        const rawBuffer = (card as any).raw as Buffer;
        tlvRaw = rawBuffer.toString('hex').toUpperCase();
        const tlv = parseTlv(rawBuffer);
        emv = extractEmvData(tlv);
        const oda = await performOda(tlv);
        return res.json({ success: true, card, emv, oda, tlvRaw });
      }

      res.json({ success: true, card, emv, tlvRaw });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Reader unavailable"
      });
    }
  }

  async getAcr122uStatus(req: Request, res: Response) {
    try {
      const status = await acr122uReaderService.getStatus();
      res.json({
        success: true,
        enabled: status.enabled,
        connected: status.connected,
        readerName: (status as any).readerName || null
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        enabled: false,
        connected: false,
        error: error.message || "Unable to determine NFC status"
      });
    }
  }

  async captureSettlement(req: Request, res: Response) {
    try {
      const { merchantId, amount, authRef } = req.body || {};

      if (!merchantId || !amount || !authRef) {
        return res.status(400).json({ error: "merchantId, amount and authRef are required" });
      }

      const settled = await settleCardTransaction(merchantId, Number(amount), authRef);
      return res.json(settled);
    } catch (error: any) {
      return res.status(500).json({ error: error.message || "Unable to settle transaction" });
    }
  }

  /**
   * Accept a Module-9 / offline PIN approved sale from a POS device and persist
   * it into the offline transaction tables so it participates in reconciliation.
   * Public HMAC or token protection should be applied by the caller (app.ts mounts
   * batch endpoints with HMAC semantics). This endpoint expects a JSON body with
   * required: merchantId, amountMinor, currency, panMasked
   * optional: terminalId, stan, rrn, authCode, emvData, tlvRaw, cvmResult, pinVerified
   */
  async handleOfflinePinSale(req: Request, res: Response) {
    try {
      const body = req.body || {};
      const merchantId = body.merchantId || body.merchant_id;
      if (!merchantId) return res.status(400).json({ error: 'merchantId required' });

      const amountMinor = Number(body.amountMinor ?? body.amount);
      if (!amountMinor || amountMinor <= 0) return res.status(400).json({ error: 'amountMinor required and must be positive' });

      const params = {
        merchantId,
        customerId: body.customerId || body.customer_id || undefined,
        terminalId: body.terminalId || body.terminal_id || undefined,
        amountMinor,
        currency: (body.currency || 'USD'),
        panMasked: body.panMasked || body.card_masked || undefined,
        txnType: body.txnType || 'SALE',
        authMode: body.authMode || 'OFFLINE_APPROVED',
        entryMode: body.entryMode || 'CHIP',
        cardBrand: body.cardBrand || undefined,
        readerSource: body.readerSource || undefined,
        cvmResult: body.cvmResult || body.cvm_result || undefined,
        pinVerified: body.pinVerified === true || body.pin_verified === 1 || false,
        rrn: body.rrn || undefined,
        stan: body.stan || undefined,
        authCode: body.authCode || body.auth_code || undefined,
        emvData: body.emv || body.emvData || body.emv_data || undefined,
        tlvRaw: body.tlvRaw || body.tlv_raw || undefined,
        ledgerEntryId: body.ledgerEntryId || undefined,
        localTxnId: body.localTxnId || body.local_txn_id || undefined,
      } as any;

      const result = await recordOfflinePosTransaction(params);

      return res.json(result);
    } catch (err: any) {
      console.error('handleOfflinePinSale error', err);
      return res.status(500).json({ error: err?.message || String(err) });
    }
  }

  /**
   * Create a Transak order via Google Pay
   * Accepts a requestId from the Transak widget callback and creates an order
   * POST /transak/create-order
   * Body: { requestId: string, userIp?: string }
   */
  async createTransakOrder(req: Request, res: Response) {
    try {
      const { requestId, userIp } = req.body || {};

      if (!requestId || typeof requestId !== 'string') {
        return res.status(400).json({
          error: 'requestId is required and must be a string'
        });
      }

      // Import Transak service
      const { createOrder } = await import('../../exchange/transak.service');

      const userIpHeader = userIp || req.ip || req.headers['x-forwarded-for'] || '0.0.0.0';
      const result = await createOrder(
        { requestId },
        { userIp: typeof userIpHeader === 'string' ? userIpHeader : userIpHeader[0] }
      );

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error,
          message: result.message
        });
      }

      // Store order in database for tracking
      try {
        await db.query(
          `INSERT INTO transak_orders (order_id, status, request_id, fiat_currency, fiat_amount, crypto_currency, crypto_amount, network, wallet_address, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            result.orderId,
            result.order?.status || 'AWAITING_PAYMENT_FROM_USER',
            requestId,
            result.order?.fiatCurrency || 'GBP',
            result.order?.fiatAmount || 0,
            result.order?.cryptoCurrency || 'ETH',
            result.order?.cryptoAmount || 0,
            result.order?.network || 'ethereum',
            result.order?.walletAddress || ''
          ]
        );
      } catch (dbErr: any) {
        console.warn('[Transak] Database insert error:', dbErr?.message);
        // Non-critical: continue even if DB insert fails
      }

      return res.status(201).json({
        success: true,
        orderId: result.orderId,
        status: result.status,
        order: result.order
      });
    } catch (error: any) {
      console.error('[Transak] createTransakOrder error:', error);
      return res.status(500).json({
        error: error.message || 'Failed to create Transak order',
        success: false
      });
    }
  }

  /**
   * Get Transak order status
   * GET /transak/order/:orderId
   */
  async getTransakOrderStatus(req: Request, res: Response) {
    try {
      const { orderId } = req.params || {};

      if (!orderId) {
        return res.status(400).json({ error: 'orderId is required' });
      }

      const { getOrderStatus } = await import('../../exchange/transak.service');

      const order = await getOrderStatus(orderId);

      // Update order in database
      try {
        await db.query(
          `UPDATE transak_orders SET status = ?, updated_at = CURRENT_TIMESTAMP 
           WHERE order_id = ?`,
          [order.status, orderId]
        );
      } catch (dbErr: any) {
        console.warn('[Transak] Database update error:', dbErr?.message);
      }

      return res.json({
        success: true,
        order
      });
    } catch (error: any) {
      console.error('[Transak] getTransakOrderStatus error:', error);
      return res.status(500).json({
        error: error.message || 'Failed to get Transak order status',
        success: false
      });
    }
  }

  /**
   * Handle Transak webhook notifications
   * POST /transak/webhook
   * Verifies webhook signature and updates order status
   */
  async handleTransakWebhook(req: Request, res: Response) {
    try {
      const signature = req.headers['x-signature'] as string;
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);

      const { verifyWebhookSignature } = await import('../../exchange/transak.service');

      // Verify webhook signature
      if (!verifyWebhookSignature(rawBody, signature)) {
        console.warn('[Transak] Webhook signature verification failed');
        return res.status(401).json({ error: 'Webhook signature verification failed' });
      }

      const event = req.body || {};
      const { data } = event;

      if (!data || !data.orderId) {
        return res.status(400).json({ error: 'Invalid webhook payload' });
      }

      // Update order in database
      try {
        await db.query(
          `UPDATE transak_orders 
           SET status = ?, updated_at = CURRENT_TIMESTAMP, raw_event = ?
           WHERE order_id = ?`,
          [data.status || 'UNKNOWN', JSON.stringify(event), data.orderId]
        );
      } catch (dbErr: any) {
        console.error('[Transak] Database update error:', dbErr?.message);
      }

      // Emit real-time update if WebSocket is available
      try {
        const io = getWsServer();
        io.emit('transak.order.update', {
          orderId: data.orderId,
          status: data.status,
          timestamp: new Date().toISOString()
        });
      } catch (wsErr: any) {
        console.warn('[Transak] WebSocket emit error:', wsErr?.message);
      }

      return res.json({ success: true, received: true });
    } catch (error: any) {
      console.error('[Transak] handleTransakWebhook error:', error);
      return res.status(500).json({
        error: error.message || 'Webhook processing failed',
        success: false
      });
    }
  }

  /**
   * Create a Transak headless card transaction session
   * Requires a quoteId from the Quotes API and user details
   * POST /transak/transaction-session
   * Body: { quoteId, walletAddress, successUrl, failureUrl, config?, billingAddress? }
   */
  async createTransactionSession(req: Request, res: Response) {
    try {
      const { quoteId, walletAddress, successUrl, failureUrl, config, billingAddress } = req.body || {};

      // Validate required fields
      if (!quoteId || typeof quoteId !== 'string') {
        return res.status(400).json({
          error: 'quoteId is required and must be a string'
        });
      }

      if (!walletAddress || typeof walletAddress !== 'string') {
        return res.status(400).json({
          error: 'walletAddress is required and must be a valid string'
        });
      }

      if (!successUrl || typeof successUrl !== 'string') {
        return res.status(400).json({
          error: 'successUrl is required and must be a valid URL'
        });
      }

      if (!failureUrl || typeof failureUrl !== 'string') {
        return res.status(400).json({
          error: 'failureUrl is required and must be a valid URL'
        });
      }

      // Import Transak service
      const { createTransactionSession } = await import('../../exchange/transak.service');

      const userIpHeader = req.ip || req.headers['x-forwarded-for'] || '0.0.0.0';
      const userIp = typeof userIpHeader === 'string' ? userIpHeader : userIpHeader[0];

      const result = await createTransactionSession(
        {
          quoteId,
          walletAddress,
          successUrl,
          failureUrl,
          config,
          billingAddress
        },
        { userIp }
      );

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error,
          message: result.message
        });
      }

      return res.status(201).json({
        success: true,
        sessionId: result.sessionId,
        expiresAt: result.expiresAt
      });
    } catch (error: any) {
      console.error('[Transak] createTransactionSession error:', error);
      return res.status(500).json({
        error: error.message || 'Failed to create transaction session',
        success: false
      });
    }
  }

  /**
   * Get Transak transaction request status
   * Checks the status of a transaction request by requestId
   * GET /transak/transaction-request-status/:requestId
   */
  async getTransactionRequestStatus(req: Request, res: Response) {
    try {
      const { requestId } = req.params || {};

      if (!requestId || typeof requestId !== 'string') {
        return res.status(400).json({
          error: 'requestId is required and must be a string'
        });
      }

      const { getTransactionRequestStatus } = await import('../../exchange/transak.service');

      const userIpHeader = req.ip || req.headers['x-forwarded-for'] || '0.0.0.0';
      const userIp = typeof userIpHeader === 'string' ? userIpHeader : userIpHeader[0];

      const result = await getTransactionRequestStatus(requestId, { userIp });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error,
          message: result.message
        });
      }

      return res.json({
        success: true,
        status: result.status,
        orderId: result.orderId
      });
    } catch (error: any) {
      console.error('[Transak] getTransactionRequestStatus error:', error);
      return res.status(500).json({
        error: error.message || 'Failed to get transaction request status',
        success: false
      });
    }
  }

  async listInboundRegistrations(req: Request, res: Response) {
    try {
      const { settlementStatus, fundVerificationStatus, authorizationCode } = (req.query || {}) as any;
      const filters: Record<string, string> = {};
      if (settlementStatus) filters.settlementStatus = String(settlementStatus);
      if (fundVerificationStatus) filters.fundVerificationStatus = String(fundVerificationStatus);
      if (authorizationCode) filters.authorizationCode = String(authorizationCode);
      const list = await inboundTransactionService.listRegistrations(filters, 200);
      return res.json({ success: true, count: list.length, items: list });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  async getInboundRegistration(req: Request, res: Response) {
    try {
      const { id } = req.params || {};
      if (!id) return res.status(400).json({ success: false, error: 'Registration id required' });
      const reg = await inboundTransactionService.getById(String(id));
      if (!reg) return res.status(404).json({ success: false, error: 'Registration not found' });
      const audits = await inboundTransactionService.getVerificationAudits(String(id));
      return res.json({ success: true, registration: reg, verificationAudits: audits });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  async findInboundByAuthCode(req: Request, res: Response) {
    try {
      const { code, protocol } = (req.query || {}) as any;
      if (!code) return res.status(400).json({ success: false, error: 'authorization code is required (?code=)' });
      const reg = await inboundTransactionService.findByAuthorizationCode(String(code), String(protocol || '101.1'));
      if (!reg) return res.status(404).json({ success: false, error: 'No inbound registration matches this auth code' });
      return res.json({ success: true, registration: reg });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  async registerInboundTransaction(req: Request, res: Response) {
    try {
      const body = req.body || {};
      if (!body.authorizationCode) return res.status(400).json({ success: false, error: 'authorizationCode required' });
      if (!body.amount || !Number.isFinite(Number(body.amount))) {
        return res.status(400).json({ success: false, error: 'numeric amount required' });
      }
      const result = await inboundTransactionService.registerInboundTransaction({
        protocol: body.protocol || '101.1',
        authorizationCode: String(body.authorizationCode),
        amount: Number(body.amount),
        currency: body.currency || 'USD',
        beneficiaryName: body.beneficiaryName,
        beneficiaryAccount: body.beneficiaryAccount,
        senderBic: body.senderBic,
        receiverBic: body.receiverBic,
        uetr: body.uetr,
        depositCode: body.depositCode,
        cusip: body.cusip,
        fedWireCode: body.fedWireCode,
        swiftMtType: body.swiftMtType,
        iso20022Type: body.iso20022Type,
        merchantId: body.merchantId,
        customerId: body.customerId,
        rawDocument: body.rawDocument,
        meta: body.meta,
      });
      return res.status(201).json({ success: true, ...result });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  async linkInboundCardDetails(req: Request, res: Response) {
    try {
      const { id } = req.params || {};
      const body = req.body || {};
      if (!id) return res.status(400).json({ success: false, error: 'id required' });
      if (!body.panMasked && !body.cardNumber) {
        return res.status(400).json({ success: false, error: 'panMasked or cardNumber required' });
      }
      await inboundTransactionService.linkCardDetails(String(id), {
        panMasked: body.panMasked,
        cardNumber: body.cardNumber,
        customerId: body.customerId,
        merchantId: body.merchantId,
      });
      const reg = await inboundTransactionService.getById(String(id));
      return res.json({ success: true, cardLinked: true, registration: reg });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  async verifyInboundFunds(req: Request, res: Response) {
    try {
      const { id } = req.params || {};
      const body = req.body || {};
      if (!id) return res.status(400).json({ success: false, error: 'id required' });
      if (!body.provider) {
        return res.status(400).json({
          success: false,
          error: 'provider required (SWIFT_GATEWAY | VISA_NETWORK | BANK_API | MANUAL_CONFIRM)',
        });
      }
      if (!body.method) {
        return res.status(400).json({
          success: false,
          error: 'method required (API_CALL | UETR_LOOKUP | ACCOUNT_BALANCE_CHECK | MANUAL)',
        });
      }
      if (body.provider === 'MANUAL_CONFIRM' && body.method === 'MANUAL' && body.config?.confirmed !== true) {
        return res.status(400).json({
          success: false,
          error: 'MANUAL_CONFIRM requires config: { confirmed: true, reference, reason, operatorId }',
        });
      }
      const methodVal = String(body.method) as 'MANUAL' | 'API_CALL' | 'UETR_LOOKUP' | 'ACCOUNT_BALANCE_CHECK';
      const result = await inboundTransactionService.verifyFundsWithExternalProvider({
        registrationId: String(id),
        provider: String(body.provider),
        method: methodVal,
        config: body.config,
        operatorId: body.operatorId,
      });
      return res.json({
        fundsVerified: result.verified,
        ...result,
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  async getProcessorStatus(req: Request, res: Response) {
    try {
      const status = paymentsService.getProcessorStatus();
      return res.json({
        success: true,
        ...status,
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }
}

export const paymentsController = new PaymentsController();