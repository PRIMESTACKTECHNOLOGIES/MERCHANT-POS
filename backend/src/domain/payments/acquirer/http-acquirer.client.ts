import axios from 'axios';
import { acquirerConfig } from '../../../config/acquirer';
import {
  AcquirerAuthRequest,
  AcquirerAuthResponse,
  AcquirerCaptureRequest,
  AcquirerCaptureResponse,
} from './acquirer.types';

export class HttpAcquirerClient {
  private readonly baseUrl: string;

  constructor() {
    if (!acquirerConfig.host) throw new Error('ACQUIRER_HOST missing');
    if (acquirerConfig.protocol !== 'http-json') {
      throw new Error('ACQUIRER_PROTOCOL=iso8583-tcp is not implemented by this client');
    }
    this.baseUrl = acquirerConfig.host.replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    return acquirerConfig.apiKey ? { 'X-API-Key': acquirerConfig.apiKey } : {};
  }

  async authorize(req: AcquirerAuthRequest): Promise<AcquirerAuthResponse> {
    const response = await axios.post(`${this.baseUrl}/card/authorize`, req, {
      timeout: 8_000,
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
    });
    const data = response.data || {};
    const approved = data.success === true && String(data.responseCode) === '00';
    return {
      success: approved,
      responseCode: String(data.responseCode || '96'),
      status: approved ? 'Approved' : 'Declined',
      authRef: data.authRef,
      approvalCode: data.approvalCode,
      message: data.message,
    };
  }

  async capture(req: AcquirerCaptureRequest): Promise<AcquirerCaptureResponse> {
    const response = await axios.post(`${this.baseUrl}/card/capture`, req, {
      timeout: 8_000,
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
    });
    const data = response.data || {};
    const captured = data.success === true && String(data.responseCode) === '00';
    return {
      success: captured,
      responseCode: String(data.responseCode || '96'),
      status: captured ? 'Captured' : 'Declined',
      captureRef: data.captureRef,
      message: data.message,
    };
  }
}
