/**
 * Acquirer Configuration
 * ─────────────────────────────────────────────────────────────────────────────
 * Cryptographic defaults sourced from processor certification documents:
 *   Table 2.1 / 2.2 Confirmed Cipher Specs:
 *     DES:       Block=64bit (8 bytes), Key=56bit (+8 parity)
 *     Triple DES:Block=64bit (8 bytes), Key=112bit (16 bytes 2-key) OR 168bit (24 bytes 3-key)
 *     AES:       Block=128bit (16 bytes), Key=128/192/256bit
 *
 * ISO 8583 Security Defaults (per crypto.spec.ts / ISO_8583_SECURITY):
 *   MAC algorithm  : Retail-MAC with 2-key 3DES
 *   MAC field      : DE64 (8 bytes) — switch to DE128 for 16-byte HMAC
 *   PIN block      : ANSI X9.8 Format 0 under 2-key 3DES PEK
 *   Message enc    : 3DES-CBC 2-key for legacy networks; AES-256-GCM for Vault Bank
 *
 * Regulatory (RA 11917 IRR):
 *   Pre-licensing inspection (PNP-SOSIA), minimum-age staff, mandatory training
 *   categories (PLTC, SecurityManager, K9, Armored, CrisisMgmt, etc.) required.
 *
 * Env vars:
 *   ACQUIRER_HOST            = https://your-acquirer.com  (required for live)
 *   ACQUIRER_PORT            = 443
 *   ACQUIRER_PROTOCOL        = http-json | iso8583-tcp
 *   ACQUIRER_API_KEY         = API key for the acquirer
 *   ACQUIRER_MERCHANT_ACCOUNT= merchant account ID at acquirer
 *   ACQUIRER_TIMEOUT_MS      = request timeout ms (default 8000)
 *   PSP_BASE_URL             = licensed PSP REST base URL (outranks scheme routes)
 *   PSP_API_KEY              = bearer token for the PSP REST API
 *   ACQUIRER_TLS_CERT        = path to TLS client cert (mutual TLS)
 *   ACQUIRER_TLS_KEY         = path to TLS client key
 *   ACQUIRER_TLS_CA          = path to CA cert bundle
 *   ACQUIRER_MAC_KEY         = 16 or 24 byte HEX — Retail 3DES MAC key (ISO 8583 DE64/DE128)
 *   ACQUIRER_PIN_KEY         = 16 or 24 byte HEX — 3DES PIN Encryption Key (ANSI X9.8)
 *   ACQUIRER_MAC_ALGORITHM   = retail-mac-3des | cbc-mac-3des | cbc-mac-aes | hmac-sha256 | hmac-sha512
 *   ACQUIRER_MAC_FIELD       = 64 or 128
 *   ACQUIRER_MAC_LENGTH      = 8 or 16 (bytes)
 *   ACQUIRER_KEY_MODE        = 2key-3des | 3key-3des | aes-256
 *   DEFAULT_TID              = default terminal ID
 *   MCC                      = merchant category code (ISO 18245)
 *   PROCESSOR_MODE           = offline | online
 *   PROCESSOR_TCP_HOST       = TCP host for ISO 8583 TCP connection
 *   PROCESSOR_TCP_PORT       = TCP port (default 8583)
 *   PROCESSOR_TIMEOUT_MS     = processor request timeout
 */

import type { AcquirerKeyMode, Iso8583MacAlgorithm } from '../domain/payments/acquirer/iso8583.security';
import { ISO_8583_SECURITY, PROCESSOR_SECURITY_POLICY } from './crypto.spec';

export interface AcquirerConfig {
  host:             string;
  port?:            number;
  apiKey?:          string;
  protocol:         'iso8583-tcp' | 'http-json';
  merchantId:       string;
  merchantAccount?: string;
  terminalId?:      string;
  timeoutMs:        number;
  // PSP (licensed acquirer REST API). When set it outranks every scheme route.
  pspBaseUrl?:      string;
  pspApiKey?:       string;
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
  const DEFAULT_MAC_FIELD    = ISO_8583_SECURITY.DEFAULT_MAC_FIELD;
  const DEFAULT_MAC_LENGTH   = ISO_8583_SECURITY.DEFAULT_MAC_LENGTH_BYTES;
  const DEFAULT_MAC_ALG      = ISO_8583_SECURITY.DEFAULT_MAC_ALGORITHM as Iso8583MacAlgorithm;
  const DEFAULT_KEY_MODE: AcquirerKeyMode = 'STATIC';

  return {
    host:            (process.env.ACQUIRER_HOST?.trim() || '').replace(/^(tcp|tls):\/\//, ''),
    port:            process.env.ACQUIRER_PORT            ? Number(process.env.ACQUIRER_PORT)            : undefined,
    apiKey:          process.env.ACQUIRER_API_KEY?.trim()                          || undefined,
    protocol:        (process.env.ACQUIRER_PROTOCOL as any)                        || 'http-json',
    merchantId:      process.env.ACQUIRER_MERCHANT_ACCOUNT?.trim()                 || process.env.PROCESSOR_MERCHANT_ID?.trim() || 'MRC-1001',
    merchantAccount: process.env.ACQUIRER_MERCHANT_ACCOUNT?.trim()                 || process.env.PROCESSOR_MERCHANT_ID?.trim() || 'MRC-1001',
    terminalId:      process.env.DEFAULT_TID?.trim()                               || process.env.PROCESSOR_TERMINAL_ID?.trim() || 'T2013-001',
    timeoutMs:       process.env.ACQUIRER_TIMEOUT_MS      ? Number(process.env.ACQUIRER_TIMEOUT_MS)      : 8000,
    pspBaseUrl:      process.env.PSP_BASE_URL?.trim()                              || undefined,
    pspApiKey:       process.env.PSP_API_KEY?.trim()                               || undefined,
    tlsCert:         process.env.ACQUIRER_TLS_CERT?.trim()                         || undefined,
    tlsKey:          process.env.ACQUIRER_TLS_KEY?.trim()                          || undefined,
    tlsCa:           process.env.ACQUIRER_TLS_CA?.trim()                           || undefined,
    keyMode:         (process.env.ACQUIRER_KEY_MODE as AcquirerKeyMode)            || DEFAULT_KEY_MODE,
    macAlgorithm:    (process.env.ACQUIRER_MAC_ALGORITHM as Iso8583MacAlgorithm)   || DEFAULT_MAC_ALG,
    macKey:          process.env.ACQUIRER_MAC_KEY?.trim()                          || undefined,
    pinKey:          process.env.ACQUIRER_PIN_KEY?.trim()                          || undefined,
    dukptIpek:       process.env.ACQUIRER_DUKPT_IPEK?.trim()                       || undefined,
    dukptKsn:        process.env.ACQUIRER_DUKPT_KSN?.trim()                        || undefined,
    macField:        process.env.ACQUIRER_MAC_FIELD        ? Number(process.env.ACQUIRER_MAC_FIELD)        : DEFAULT_MAC_FIELD,
    macLength:       process.env.ACQUIRER_MAC_LENGTH       ? Number(process.env.ACQUIRER_MAC_LENGTH)       : DEFAULT_MAC_LENGTH,
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
  const hasGenericProvider = !!(
    (process.env.EXTERNAL_FUND_PROVIDER_ENDPOINT?.trim() || process.env.VAULT_OMNIBUS_ENDPOINT?.trim()) &&
    (process.env.EXTERNAL_FUND_PROVIDER_API_KEY?.trim()   || process.env.VAULT_OMNIBUS_API_KEY?.trim())
  );
  if (hasGenericProvider) return true;
  const gpEnabled =
    process.env.GLOBAL_PAYMENTS_ENABLE?.trim().toLowerCase() !== 'false' &&
    (!process.env.GLOBAL_PAYMENTS_ENABLE || process.env.GLOBAL_PAYMENTS_ENABLE.trim().length > 0);
  const hasGlobalPaymentsUcp = gpEnabled && !!(
    process.env.GLOBAL_PAYMENTS_API_KEY?.trim() &&
    process.env.GLOBAL_PAYMENTS_SECRET_KEY?.trim() &&
    process.env.GLOBAL_PAYMENTS_API_URL?.trim()
  );
  if (hasGlobalPaymentsUcp) return true;
  return !!acquirerConfig.host && acquirerConfig.host.length > 0;
}

export function isInternalProcessorAllowed(): boolean {
  return (process.env.TEST_1USD_SANDBOX?.trim().toLowerCase() === 'true')
      || (process.env.PROCESSOR_ACTIVATED?.trim().toLowerCase() === 'true');
}

export function isProcessorOnline(): boolean {
  const testSandbox = process.env.TEST_1USD_SANDBOX?.trim().toLowerCase() === 'true';
  const activated  = processorConfig.mode === 'online'
    && processorConfig.activated
    && !!processorConfig.sponsorIca
    && !!processorConfig.processorId
    && !!processorConfig.hostCertificationId
    && !!processorConfig.emvL2CertificationId
    && isAcquirerConfigured();
  if (activated) return true;
  if (testSandbox) return true;
  const gpEnabled =
    process.env.GLOBAL_PAYMENTS_ENABLE?.trim().toLowerCase() !== 'false'
    && (!process.env.GLOBAL_PAYMENTS_ENABLE || process.env.GLOBAL_PAYMENTS_ENABLE.trim().length > 0);
  const hasGlobalPaymentsLive = gpEnabled && !!(
    process.env.GLOBAL_PAYMENTS_API_KEY?.trim() &&
    process.env.GLOBAL_PAYMENTS_SECRET_KEY?.trim() &&
    process.env.GLOBAL_PAYMENTS_API_URL?.trim()
  );
  if (hasGlobalPaymentsLive && processorConfig.mode === 'online') return true;
  return false;
}

export function isProcessorTestModeActive(): {
  active: boolean;
  usdCap: number;
  requiresExplicitActivationEnv: boolean;
} {
  const active = process.env.TEST_1USD_SANDBOX?.trim().toLowerCase() === 'true';
  return {
    active,
    usdCap: 1.0,
    requiresExplicitActivationEnv: true,
  };
}

export function assertAmountWithinTestCapOrThrow(amount: number, currency: string): void {
  const cap = isProcessorTestModeActive();
  if (!cap.active) return;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('TEST_1USD_SANDBOX: amount must be positive');
  }
  const cur = String(currency || '').toUpperCase().trim();
  if (cur !== 'USD') {
    throw new Error(`TEST_1USD_SANDBOX only permits USD transactions (got ${cur || 'empty'}). Full processor online mode required for other currencies.`);
  }
  if (amount > cap.usdCap) {
    throw new Error(`TEST_1USD_SANDBOX cap is USD ${cap.usdCap.toFixed(2)} per transaction (got $${amount.toFixed(2)}). Set PROCESSOR_ACTIVATED=true with a real ICA/PID/host_cert/emv_l2_cert for larger amounts.`);
  }
}

