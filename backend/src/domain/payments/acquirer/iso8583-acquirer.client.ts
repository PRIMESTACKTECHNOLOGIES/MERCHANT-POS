import { acquirerConfig } from '../../../config/acquirer';
import { IsoTcpClient } from './iso-tcp.client';
import { Iso8583Codec, IsoMessage } from './iso8583.codec';
import { iso8583HeaderFraming } from './headerFraming';
import {
  AcquirerAuthRequest,
  AcquirerAuthResponse,
  AcquirerCaptureRequest,
  AcquirerCaptureResponse,
} from './acquirer.types';
import { createIso8583MacEngine } from './iso8583.security';
import { getResponseCodeInfo, isApprovalCode, getCardholderMessage } from './iso8583.responseCodes';

export class Iso8583AcquirerClient {
  private readonly tcp: IsoTcpClient;
  private readonly macEngine = createIso8583MacEngine({
    keyMode: acquirerConfig.keyMode,
    macAlgorithm: acquirerConfig.macAlgorithm,
    macKey: acquirerConfig.macKey,
    dukptIpek: acquirerConfig.dukptIpek,
    dukptKsn: acquirerConfig.dukptKsn,
    macField: acquirerConfig.macField,
    macLength: acquirerConfig.macLength,
  });
  private readonly codec = new Iso8583Codec(undefined, {
    framing: iso8583HeaderFraming,
    mac: {
      field: acquirerConfig.macField ?? 64,
      calculate: (messageWithoutMac) => this.macEngine.calculateMac(messageWithoutMac, this.macEngine.getKeyProvider().getMacKey()),
      verify: (messageWithoutMac, receivedMac) => this.macEngine.verifyMac(messageWithoutMac, this.macEngine.getKeyProvider().getMacKey(), receivedMac),
    },
    macEngine: this.macEngine,
    keyProvider: this.macEngine.getKeyProvider(),
  });

  constructor() {
    if (!acquirerConfig.host || !acquirerConfig.port) {
      throw new Error('ACQUIRER_HOST and ACQUIRER_PORT are required for ISO8583');
    }
    this.tcp = new IsoTcpClient(acquirerConfig.host, acquirerConfig.port, acquirerConfig.timeoutMs);
  }

  async authorize(req: AcquirerAuthRequest): Promise<AcquirerAuthResponse> {
    const response = this.codec.unpack(await this.tcp.send(this.codec.pack(this.buildAuth(req))));
    const responseCode = String(response.fields[39] || '96');
    const info = getResponseCodeInfo(responseCode);
    const success = info.action === 'APPROVE';
    const partialApproval = info.action === 'PARTIAL';
    const referral = info.action === 'REFERRAL';
    const approvedAmountMinor = partialApproval ? this.amountFromField(response.fields[4]) : undefined;
    return {
      success,
      responseCode,
      status: success ? 'Approved' : referral ? 'Referral' : partialApproval ? 'PartialApproval' : 'Declined',
      approvedAmountMinor,
      authRef: this.stringField(response.fields[37]),
      approvalCode: this.stringField(response.fields[38]),
      message: getCardholderMessage(responseCode),
      retryable: info.retryable,
      issuerRetry: info.issuerRetry,
    };
  }

  async capture(req: AcquirerCaptureRequest): Promise<AcquirerCaptureResponse> {
    const response = this.codec.unpack(await this.tcp.send(this.codec.pack(this.buildCapture(req))));
    const responseCode = String(response.fields[39] || '96');
    const success = responseCode === '00';
    return {
      success,
      responseCode,
      status: success ? 'Captured' : 'Declined',
      captureRef: this.stringField(response.fields[37]),
      message: success ? 'Captured' : 'Declined',
    };
  }

  private buildAuth(req: AcquirerAuthRequest): IsoMessage {
    if (!Number.isSafeInteger(req.amountMinor) || req.amountMinor < 0 || req.amountMinor > 999999999999) {
      throw new Error('Authorization amount must be an integer from 0 to 999999999999 minor units');
    }
    if (req.protocol === '101.1' && !req.cardNumber) {
      throw new Error('Card number is required for protocol 101.1');
    }
    if (req.protocol === '101.6' && !req.emvField55) {
      throw new Error('EMV field 55 is required for protocol 101.6');
    }

    const fields: Record<number, string | Buffer> = {
      3: req.processingCode || '000000',
      4: String(req.amountMinor).padStart(12, '0'),
      7: this.transmissionDateTime(),
      11: this.stan(req.stan),
      41: acquirerConfig.terminalId || 'TERM0001',
      42: req.merchantAccount,
      49: req.currency,
      22: req.protocol === '101.6' ? '051' : '010',
      23: req.cardSequenceNumber || '001',
      25: req.posConditionCode || '00',
    };
    if (req.protocol === '101.1') {
      if (req.cardNumber) fields[2] = req.cardNumber;
      if (req.expiry) fields[14] = req.expiry;
    } else if (req.emvField55) {
      fields[55] = Buffer.from(req.emvField55, 'hex');
    }
    return { mti: '0200', fields };
  }

  private transmissionDateTime(): string {
    const now = new Date();
    const two = (value: number) => String(value).padStart(2, '0');
    return `${two(now.getUTCMonth() + 1)}${two(now.getUTCDate())}${two(now.getUTCHours())}${two(now.getUTCMinutes())}${two(now.getUTCSeconds())}`;
  }

  private stan(value?: string): string {
    if (value !== undefined) {
      if (!/^\d{6}$/.test(value)) throw new Error('STAN must be exactly 6 digits');
      return value;
    }
    return String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
  }

  private amountFromField(value: string | Buffer | undefined): number | undefined {
    if (value === undefined) return undefined;
    const amount = Number(Buffer.isBuffer(value) ? value.toString('ascii') : value);
    return Number.isSafeInteger(amount) ? amount : undefined;
  }

  private buildCapture(req: AcquirerCaptureRequest): IsoMessage {
    return {
      mti: '0220',
      fields: {
        3: '000000',
        4: String(req.amountMinor).padStart(12, '0'),
        37: req.authRef,
        41: acquirerConfig.terminalId || 'TERM0001',
        42: req.merchantAccount,
        49: req.currency,
      },
    };
  }

  private stringField(value: string | Buffer | undefined): string | undefined {
    return value === undefined ? undefined : Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  }
}
