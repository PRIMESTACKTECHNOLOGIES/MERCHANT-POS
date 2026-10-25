/**
 * PSP Acquirer Client (capture seam)
 * ─────────────────────────────────────────────────────────────────────────────
 * The 201.3 capture leg goes through this seam (cardCapture.ts →
 * getAcquirerClient()), not through the authorize seam. Without a PSP client
 * here, a PSP-authorized charge falls back to an INTERNAL_LEDGER receivable
 * instead of collecting real money.
 *
 * Mirrors domain/payments/acquirer/psp-acquirer.client.ts against the
 * acquirer-service contract, which additionally requires reverse().
 */

import axios, { AxiosInstance } from 'axios';
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

/** "MMYY" | "MM/YY" → the month/year fields the PSP expects. */
function splitExpiry(expiry?: string): { expiryMonth?: string; expiryYear?: string } {
  const digits = String(expiry || '').replace(/\D/g, '');
  if (digits.length < 4) return {};
  return { expiryMonth: digits.slice(0, 2), expiryYear: digits.slice(2, 4) };
}

export class PspAcquirerClient implements IAcquirerClient {
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
        fundsType: 'external',
        cardType: 'external',
        raw: psp,
      };
    } catch (error: any) {
      const data = error?.response?.data || {};
      return {
        success: false,
        responseCode: String(data.processorResponseCode ?? '96'),
        status: 'Declined',
        message: data.message || error?.message || 'PSP unreachable',
        raw: data,
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
          stan: req.stan,
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
        raw: psp,
      };
    } catch (error: any) {
      const data = error?.response?.data || {};
      return {
        success: false,
        responseCode: String(data.processorResponseCode ?? '96'),
        status: 'Declined',
        message: data.message || error?.message || 'PSP capture failed',
        raw: data,
      };
    }
  }

  async reverse(req: AcquirerReversalRequest): Promise<AcquirerReversalResponse> {
    try {
      const response = await this.http.post(
        `/payments/${encodeURIComponent(req.authRef)}/reverse`,
        {
          amount: req.amountMinor,
          currency: req.currency,
          reason: req.reason || 'CUSTOMER_REQUEST',
        },
      );

      const psp = response.data || {};
      const ok = psp.status === 'REVERSED';

      return {
        success: ok,
        responseCode: String(psp.processorResponseCode ?? (ok ? '00' : '05')),
        reversalRef: psp.reversalId ?? psp.id,
        message: psp.message,
      };
    } catch (error: any) {
      const data = error?.response?.data || {};
      return {
        success: false,
        responseCode: String(data.processorResponseCode ?? '96'),
        message: data.message || error?.message || 'PSP reversal failed',
      };
    }
  }
}
