/**
 * HTTP JSON Acquirer Client
 * ─────────────────────────────────────────────────────────────────────────────
 * Production implementation of IAcquirerClient over HTTPS/JSON.
 * Replace with Iso8583TcpClient for ISO 8583 TCP acquirers — the interface
 * (authorize/capture/reverse) stays identical.
 *
 * Expected acquirer API shape:
 *   POST /card/authorize  → AcquirerAuthResponse
 *   POST /card/capture    → AcquirerCaptureResponse
 *   POST /card/reverse    → AcquirerReversalResponse
 */

import axios from 'axios';
import { acquirerConfig } from '../../config/acquirer';
import type {
  IAcquirerClient,
  AcquirerAuthRequest,
  AcquirerAuthResponse,
  AcquirerCaptureRequest,
  AcquirerCaptureResponse,
  AcquirerReversalRequest,
  AcquirerReversalResponse,
} from './AcquirerService';

export class HttpAcquirerClient implements IAcquirerClient {
  private readonly baseUrl: string;
  private readonly apiKey:  string | undefined;
  private readonly timeout: number;

  constructor() {
    if (!acquirerConfig.host) {
      throw new Error(
        'ACQUIRER_HOST is not configured in .env. ' +
        'Set ACQUIRER_HOST=https://your-acquirer.com to enable real card processing.'
      );
    }
    const h = acquirerConfig.host.replace(/\/+$/, ''); const port = acquirerConfig.port ? ':' + acquirerConfig.port : ''; this.baseUrl = /^https?:\/\//.test(h) ? h : 'http://' + h + port;
    this.apiKey  = acquirerConfig.apiKey;
    this.timeout = acquirerConfig.timeoutMs;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      h['X-API-Key']     = this.apiKey;
      h['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  // ── Authorize ───────────────────────────────────────────────────────────────
  async authorize(req: AcquirerAuthRequest): Promise<AcquirerAuthResponse> {
    const url = `${this.baseUrl}/card/authorize`;

    try {
      const res = await axios.post(url, {
        merchantAccount: req.merchantAccount,
        amountMinor:     req.amountMinor,
        currency:        req.currency,
        protocol:        req.protocol,
        cardNumber:      req.cardNumber,
        expiry:          req.expiry,
        cvv:             req.cvv,
        emvField55:      req.emvField55,
        stan:            req.stan,
        terminalId:      req.terminalId,
        posEntryMode:    req.posEntryMode,
      }, { timeout: this.timeout, headers: this.headers() });

      const data = res.data || {};
      const rc   = String(data.responseCode || data.response_code || '96');
      const approved = rc === '00' || data.success === true || /^(approved|authorized)$/i.test(String(data.status || ''));

      return {
        success:      approved,
        responseCode: rc,
        status:       approved ? 'Approved' : 'Declined',
        authRef:      data.authRef       || data.auth_ref       || data.reference,
        approvalCode: data.approvalCode  || data.approval_code  || data.authCode,
        message:      data.message       || data.description,
        raw:          data,
      };
    } catch (err: any) {
      const data = err?.response?.data || {};
      const rc   = String(data.responseCode || data.response_code || '91'); // '91' = issuer unavailable
      return {
        success:      false,
        responseCode: rc,
        status:       'Declined',
        message:      data.message || err.message || 'Acquirer unreachable',
        raw:          data,
      };
    }
  }

  // ── Capture ─────────────────────────────────────────────────────────────────
  async capture(req: AcquirerCaptureRequest): Promise<AcquirerCaptureResponse> {
    const url = `${this.baseUrl}/card/capture`;

    try {
      const res = await axios.post(url, {
        merchantAccount:        req.merchantAccount,
        amountMinor:            req.amountMinor,
        currency:               req.currency,
        protocol:               req.protocol,
        authorizationReference: req.authRef,
        stan:                   req.stan,
        terminalId:             req.terminalId,
      }, { timeout: this.timeout, headers: this.headers() });

      const data = res.data || {};
      const rc   = String(data.responseCode || '96');
      const ok   = rc === '00' || data.success === true;

      return {
        success:      ok,
        responseCode: rc,
        status:       ok ? 'Captured' : 'Declined',
        captureRef:   data.captureRef || data.capture_ref || data.reference,
        message:      data.message,
        raw:          data,
      };
    } catch (err: any) {
      const data = err?.response?.data || {};
      return {
        success:      false,
        responseCode: String(data.responseCode || '91'),
        status:       'Declined',
        message:      data.message || err.message || 'Capture failed',
        raw:          data,
      };
    }
  }

  // ── Reverse ─────────────────────────────────────────────────────────────────
  async reverse(req: AcquirerReversalRequest): Promise<AcquirerReversalResponse> {
    const url = `${this.baseUrl}/card/reverse`;

    try {
      const res = await axios.post(url, {
        merchantAccount:        req.merchantAccount,
        amountMinor:            req.amountMinor,
        currency:               req.currency,
        authorizationReference: req.authRef,
        reason:                 req.reason || 'CUSTOMER_REQUEST',
      }, { timeout: this.timeout, headers: this.headers() });

      const data = res.data || {};
      const rc   = String(data.responseCode || '96');

      return {
        success:      rc === '00' || data.success === true,
        responseCode: rc,
        reversalRef:  data.reversalRef || data.reversal_ref || data.reference,
        message:      data.message,
      };
    } catch (err: any) {
      const data = err?.response?.data || {};
      return {
        success:      false,
        responseCode: String(data.responseCode || '91'),
        message:      data.message || err.message || 'Reversal failed',
      };
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
let _client: HttpAcquirerClient | null = null;

export function getAcquirerClient(): any {
  if ((process.env.ACQUIRER_PROTOCOL || '').toLowerCase() === 'iso8583-tcp') {
    const { VaultBankAcquirerClient } = require('../../domain/payments/acquirer/vault-bank-acquirer.client');
    return new VaultBankAcquirerClient();
  }
  return _client;
}
