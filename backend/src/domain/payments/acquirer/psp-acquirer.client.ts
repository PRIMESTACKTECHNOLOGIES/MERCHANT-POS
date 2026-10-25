/**
 * PSP Acquirer Client
 * ─────────────────────────────────────────────────────────────────────────────
 * Routes card authorization and capture to a licensed PSP/acquirer REST API
 * instead of the local vault-bank pipe, so a POS charge collects REAL funds.
 *
 * Expected PSP API shape:
 *   POST /payments/authorizations      → { id, status, processorResponseCode, approvalCode }
 *   POST /payments/{authRef}/capture   → { id, captureId, status, processorResponseCode }
 *
 * Enabled when PSP_BASE_URL is configured. When it is not, the local
 * vault-bank pipe stays the default and nothing changes.
 */

import axios, { AxiosInstance } from 'axios';
import { acquirerConfig } from '../../../config/acquirer';
import {
  AcquirerAuthRequest,
  AcquirerAuthResponse,
  AcquirerCaptureRequest,
  AcquirerCaptureResponse,
} from './acquirer.types';

/** "MMYY" | "MM/YY" → the month/year fields the PSP expects. */
function splitExpiry(expiry?: string): { expiryMonth?: string; expiryYear?: string } {
  const digits = String(expiry || '').replace(/\D/g, '');
  if (digits.length < 4) return {};
  return { expiryMonth: digits.slice(0, 2), expiryYear: digits.slice(2, 4) };
}

export class PspAcquirerClient {
  private readonly http: AxiosInstance;

  constructor() {
    if (!acquirerConfig.pspBaseUrl) throw new Error('PSP_BASE_URL missing');
    this.http = axios.create({
      baseURL: acquirerConfig.pspBaseUrl,
      timeout: acquirerConfig.timeoutMs,
      headers: {
        Authorization: `Bearer ${acquirerConfig.pspApiKey || ''}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  }

  async authorize(req: AcquirerAuthRequest): Promise<AcquirerAuthResponse> {
    try {
      const response = await this.http.post('/payments/authorizations', {
        amount: req.amountMinor,
        currency: req.currency,
        merchantAccount: req.merchantAccount,
        card: {
          pan: req.cardNumber,
          ...splitExpiry(req.expiry),
        },
        emvData: req.emvField55,
        stan: req.stan,
        protocol: req.protocol,
        merchantReference: req.stan,
      });

      const psp = response.data || {};
      const approved = psp.status === 'AUTHORIZED';

      return {
        success: approved,
        responseCode: String(psp.processorResponseCode ?? (approved ? '00' : '05')),
        status: approved ? 'Approved' : 'Declined',
        authRef: psp.id,
        approvalCode: psp.approvalCode,
        message: psp.message,
      };
    } catch (error: any) {
      const data = error?.response?.data || {};
      return {
        success: false,
        responseCode: String(data.processorResponseCode ?? '96'),
        status: 'Declined',
        message: data.message || error?.message || 'PSP unreachable',
      };
    }
  }

  async capture(req: AcquirerCaptureRequest): Promise<AcquirerCaptureResponse> {
    try {
      const response = await this.http.post(
        `/payments/${encodeURIComponent(req.authRef)}/capture`,
        {
          amount: req.amountMinor,
          currency: req.currency,
        },
      );

      const psp = response.data || {};
      const captured = psp.status === 'CAPTURED';

      return {
        success: captured,
        responseCode: String(psp.processorResponseCode ?? (captured ? '00' : '05')),
        status: captured ? 'Captured' : 'Declined',
        captureRef: psp.captureId ?? psp.id,
        message: psp.message,
      };
    } catch (error: any) {
      const data = error?.response?.data || {};
      return {
        success: false,
        responseCode: String(data.processorResponseCode ?? '96'),
        status: 'Declined',
        message: data.message || error?.message || 'PSP capture failed',
      };
    }
  }
}
