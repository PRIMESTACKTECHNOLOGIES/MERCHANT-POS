/**
 * Acquirer Configuration
 * ─────────────────────────────────────────────────────────────────────────────
 * Env vars:
 *   ACQUIRER_HOST            = https://your-acquirer.com  (required for live)
 *   ACQUIRER_PORT            = 443
 *   ACQUIRER_PROTOCOL        = http-json | iso8583-tcp
 *   ACQUIRER_API_KEY         = API key for the acquirer
 *   ACQUIRER_MERCHANT_ACCOUNT= merchant account ID at acquirer
 *   ACQUIRER_TIMEOUT_MS      = request timeout ms (default 8000)
 *   ACQUIRER_TLS_CERT        = path to TLS client cert (mutual TLS)
 *   ACQUIRER_TLS_KEY         = path to TLS client key
 *   ACQUIRER_TLS_CA          = path to CA cert bundle
 *   ACQUIRER_MAC_KEY         = HMAC/MAC key for ISO 8583 message auth
 *   ACQUIRER_PIN_KEY         = PIN encryption key (ISO 9564)
 *   DEFAULT_TID              = default terminal ID
 *   MCC                      = merchant category code (ISO 18245)
 *   PROCESSOR_MODE           = offline | online
 *   PROCESSOR_TCP_HOST       = TCP host for ISO 8583 TCP connection
 *   PROCESSOR_TCP_PORT       = TCP port (default 8583)
 *   PROCESSOR_TIMEOUT_MS     = processor request timeout
 */

import type { AcquirerKeyMode, Iso8583MacAlgorithm } from '../domain/payments/acquirer/iso8583.security';

export interface AcquirerConfig {
  host:             string;
  port?:            number;
  apiKey?:          string;
  protocol:         'iso8583-tcp' | 'http-json';
  merchantId:       string;
  merchantAccount?: string;
  terminalId?:      string;
  timeoutMs:        number;
  // TLS mutual auth
  tlsCert?:         string;
  tlsKey?:          string;
  tlsCa?:           string;
  // ISO 8583 security
  keyMode?:         AcquirerKeyMode;
  macAlgorithm?:    Iso8583MacAlgorithm;
  macKey?:          string;
  pinKey?:          string;
  dukptIpek?:       string;
  dukptKsn?:        string;
  macField?:        number;
  macLength?:       number;
}

export interface ProcessorConfig {
  mode:        string;
  tcpHost:     string;
  tcpPort:     number;
  timeoutMs:   number;
  apiKey:      string;
  name:        string;
  merchantId:  string;
  terminalId:  string;
  protocol:    string;
  floorLimit:  number;
  mcc:         string;
  defaultTid:  string;
  activationCode: string;
  model:       string;
  version:     string;
  ip:          string;
  imei:        string;
  imsi:        string;
  keyId:       string;
  activated:    boolean;
  sponsorIca?:  string;
  processorId?: string;
  hostCertificationId?: string;
  emvL2CertificationId?: string;
}

function buildAcquirerConfig(): AcquirerConfig {
  return {
    host:            (process.env.ACQUIRER_HOST?.trim() || '').replace(/^(tcp|tls):\/\//, ''),
    port:            process.env.ACQUIRER_PORT            ? Number(process.env.ACQUIRER_PORT)            : undefined,
    apiKey:          process.env.ACQUIRER_API_KEY?.trim()                          || undefined,
    protocol:        (process.env.ACQUIRER_PROTOCOL as any)                        || 'http-json',
    merchantId:      process.env.ACQUIRER_MERCHANT_ACCOUNT?.trim()                 || process.env.PROCESSOR_MERCHANT_ID?.trim() || 'MRC-1001',
    merchantAccount: process.env.ACQUIRER_MERCHANT_ACCOUNT?.trim()                 || process.env.PROCESSOR_MERCHANT_ID?.trim() || 'MRC-1001',
    terminalId:      process.env.DEFAULT_TID?.trim()                               || process.env.PROCESSOR_TERMINAL_ID?.trim() || 'T2013-001',
    timeoutMs:       process.env.ACQUIRER_TIMEOUT_MS      ? Number(process.env.ACQUIRER_TIMEOUT_MS)      : 8000,
    tlsCert:         process.env.ACQUIRER_TLS_CERT?.trim()                         || undefined,
    tlsKey:          process.env.ACQUIRER_TLS_KEY?.trim()                          || undefined,
    tlsCa:           process.env.ACQUIRER_TLS_CA?.trim()                           || undefined,
    keyMode:         (process.env.ACQUIRER_KEY_MODE as AcquirerKeyMode)            || undefined,
    macAlgorithm:    (process.env.ACQUIRER_MAC_ALGORITHM as Iso8583MacAlgorithm)   || undefined,
    macKey:          process.env.ACQUIRER_MAC_KEY?.trim()                          || undefined,
    pinKey:          process.env.ACQUIRER_PIN_KEY?.trim()                          || undefined,
    dukptIpek:       process.env.ACQUIRER_DUKPT_IPEK?.trim()                       || undefined,
    dukptKsn:        process.env.ACQUIRER_DUKPT_KSN?.trim()                        || undefined,
    macField:        process.env.ACQUIRER_MAC_FIELD        ? Number(process.env.ACQUIRER_MAC_FIELD)        : undefined,
    macLength:       process.env.ACQUIRER_MAC_LENGTH       ? Number(process.env.ACQUIRER_MAC_LENGTH)       : undefined,
  };
}

export const acquirerConfig: AcquirerConfig = new Proxy({} as AcquirerConfig, {
  get(_target, prop) { return (buildAcquirerConfig() as any)[prop]; },
});

export const processorConfig: ProcessorConfig = {
  mode:           process.env.PROCESSOR_MODE?.trim()            || 'offline',
  tcpHost:        process.env.PROCESSOR_TCP_HOST?.trim()        || '177.246.47.140',
  tcpPort:        process.env.PROCESSOR_TCP_PORT  ? Number(process.env.PROCESSOR_TCP_PORT)  : 8583,
  timeoutMs:      process.env.PROCESSOR_TIMEOUT_MS ? Number(process.env.PROCESSOR_TIMEOUT_MS) : 8000,
  apiKey:         process.env.PROCESSOR_API_KEY?.trim()         || 'PSPK-58878214D6B132F04B00617DD52213F1D8CF989FB65056AF',
  name:           process.env.PROCESSOR_NAME?.trim()            || 'PRIMESTACK PAYMENT PROCESSOR',
  merchantId:     process.env.PROCESSOR_MERCHANT_ID?.trim()     || 'MRC-1001',
  terminalId:     process.env.PROCESSOR_TERMINAL_ID?.trim()     || 'T2013-001',
  protocol:       process.env.PROCESSOR_PROTOCOL?.trim()        || '201.3',
  floorLimit:     process.env.PROCESSOR_FLOOR_LIMIT ? Number(process.env.PROCESSOR_FLOOR_LIMIT) : 150000,
  mcc:            process.env.MCC?.trim()                       || '5999',
  defaultTid:     process.env.DEFAULT_TID?.trim()               || 'T2013-001',
  activationCode: process.env.PROCESSOR_ACTIVATION_CODE?.trim() || 'ACT-A27C17-F5ACC8-28765D-CD91DC',
  model:          process.env.PROCESSOR_MODEL?.trim()           || 'PRIMESTACK-POS-201.3',
  version:        process.env.PROCESSOR_VERSION?.trim()         || '2.1.3',
  ip:             process.env.PROCESSOR_IP?.trim()              || '177.246.47.140',
  imei:           process.env.PROCESSOR_IMEI?.trim()            || '353044192323970',
  imsi:           process.env.PROCESSOR_IMSI?.trim()            || '310410763505944',
  keyId:          process.env.PROCESSOR_KEY_ID?.trim()          || 'PRIMESTACK-B4C329F83258',
  activated:      process.env.PROCESSOR_ACTIVATED?.trim().toLowerCase() === 'true',
  sponsorIca:     process.env.PROCESSOR_SPONSOR_ICA?.trim()     || undefined,
  processorId:    process.env.PROCESSOR_PID?.trim()             || undefined,
  hostCertificationId: process.env.PROCESSOR_HOST_CERTIFICATION_ID?.trim() || undefined,
  emvL2CertificationId: process.env.EMV_L2_CERTIFICATION_ID?.trim() || undefined,
};

export function isAcquirerConfigured(): boolean {
  return !!acquirerConfig.host && acquirerConfig.host.length > 0;
}

export function isProcessorOnline(): boolean {
  return processorConfig.mode === 'online'
    && processorConfig.activated
    && !!processorConfig.sponsorIca
    && !!processorConfig.processorId
    && !!processorConfig.hostCertificationId
    && !!processorConfig.emvL2CertificationId
    && isAcquirerConfigured();
}
