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

export class PaymentsController {

  async charge(req: Request, res: Response) {
    try {
      const { amountMinor, currency, merchantId, pan, expiry, cvv, emv, terminalId, tlvRaw, stan, customerId } = req.body || {};

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
}

export const paymentsController = new PaymentsController();
