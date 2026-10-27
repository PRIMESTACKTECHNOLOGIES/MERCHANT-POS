/**
 * Vault Bank Acquirer TCP Client
 * ─────────────────────────────────────────────────────────────────────────────
 * Speaks the pipe-delimited text protocol used by vault-bank-acquirer.js:
 *   Send:    "0100|2=<pan>|3=000000|4=<amount>|11=<stan>|41=<tid>|42=<mid>|49=<ccy>|55=<field55>"
 *   Receive: "0110|3=000000|4=...|11=...|39=00|41=...|42=...|49=..."
 *
 * Mounted when ACQUIRER_PROTOCOL=iso8583-tcp and ACQUIRER_HOST is set.
 */

import net from 'net';
import crypto from 'crypto';
import { acquirerConfig } from '../../../config/acquirer';
import type { AcquirerAuthRequest, AcquirerAuthResponse, AcquirerCaptureRequest, AcquirerCaptureResponse } from '../../../services/acquirer/AcquirerService';

const CURRENCY_CODES: Record<string, string> = {
  USD: '840', EUR: '978', GBP: '826', AED: '784',
  SGD: '702', INR: '356', JPY: '392', CHF: '756',
  AUD: '036', CAD: '124', HKD: '344', MYR: '458',
};

function toCurrencyCode(currency: string): string {
  return CURRENCY_CODES[currency.toUpperCase()] || '840';
}

function buildPipeMsg(mti: string, fields: Record<string, string>): Buffer {
  const parts = [mti, ...Object.entries(fields).map(([k, v]) => `${k}=${v}`)];
  return Buffer.from(parts.join('|'), 'utf8');
}

function parsePipeMsg(raw: string): { mti: string; fields: Record<string, string> } {
  const parts = raw.split('|');
  const mti = parts[0];
  const fields: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq > 0) fields[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
  }
  return { mti, fields };
}

function sendTcp(message: Buffer, host: string, port: number, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let data = '';
    let settled = false;

    const timer = setTimeout(() => {
      socket.destroy();
      if (!settled) { settled = true; reject(new Error('Vault bank acquirer TCP timeout')); }
    }, timeoutMs);

    const done = (result: string) => {
      if (settled) return; settled = true;
      clearTimeout(timer); socket.destroy(); resolve(result);
    };
    const fail = (err: Error) => {
      if (settled) return; settled = true;
      clearTimeout(timer); socket.destroy(); reject(err);
    };

    socket.on('connect', () => socket.write(message));
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8');
      // Response ends when we have a complete MTI + fields
      if (data.includes('|39=') || data.includes('|3=')) done(data);
    });
    socket.on('error', fail);
    socket.on('close', () => {
      if (!settled && data) done(data);
      else if (!settled) fail(new Error('Vault bank acquirer connection closed before response'));
    });

    socket.connect(port, host);
  });
}

export class VaultBankAcquirerClient {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;

  constructor() {
    this.host = acquirerConfig.host || '127.0.0.1';
    this.port = acquirerConfig.port || 9000;
    this.timeoutMs = acquirerConfig.timeoutMs || 8000;
  }

  async authorize(req: AcquirerAuthRequest): Promise<AcquirerAuthResponse> {
    const stan = String(Math.floor(Math.random() * 900000 + 100000));
    const now  = new Date();
    const rrn  = String(now.getTime()).slice(-12);
    const txnDate = [
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      String(now.getUTCDate()).padStart(2, '0'),
    ].join('');

    const fields: Record<string, string> = {
      '2':  req.cardNumber || '',
      '3':  '000000',
      '4':  String(req.amountMinor).padStart(12, '0'),
      '7':  txnDate,
      '11': stan,
      '14': req.expiry?.replace('/', '') || '',
      '18': acquirerConfig.merchantAccount || 'MRC-1001',
      '22': req.emvField55 ? '051' : '011',
      '37': rrn,
      '41': acquirerConfig.terminalId || 'T2013-001',
      '42': req.merchantAccount || acquirerConfig.merchantId || 'MRC-1001',
      '49': toCurrencyCode(req.currency || 'USD'),
    };
    if (req.emvField55) fields['55'] = req.emvField55;
    if (req.cvv)        fields['52'] = req.cvv;

    const msg = buildPipeMsg('0100', fields);
    console.log('[VaultBankAcquirer] Sending 0100 auth to', this.host + ':' + this.port);

    let rawResponse: string;
    try {
      rawResponse = await sendTcp(msg, this.host, this.port, this.timeoutMs);
    } catch (err: any) {
      return { success: false, responseCode: '91', status: 'Declined', message: err.message, authRef: '', approvalCode: '' };
    }

    const { mti, fields: resp } = parsePipeMsg(rawResponse);
    const responseCode = resp['39'] || '96';
    const success = responseCode === '00';
    console.log('[VaultBankAcquirer] Received', mti, 'RC=' + responseCode);

    return {
      success,
      responseCode,
      status:       success ? 'Approved' : 'Declined',
      authRef:      resp['37'] || rrn,
      approvalCode: resp['38'] || (success ? stan : ''),
      message:      success ? 'Approved by vault bank acquirer' : 'Declined RC=' + responseCode,
    };
  }

  async capture(req: AcquirerCaptureRequest): Promise<AcquirerCaptureResponse> {
    // Vault bank acquirer handles capture via pending clearing queue on auth approval
    // No separate capture message needed — return success
    return {
      success:       true,
      responseCode:  '00',
      status:        'Captured',
      captureRef:    req.authRef || `CAP-${Date.now().toString(36).toUpperCase()}`,
      message:       'Captured via vault bank acquirer clearing',
    };
  }
}