/**
 * GENERIC PROVIDER CLIENT
 * ─────────────────────────────────────────────────────────────────────────────
 * Single outbound client used by every treasury engine to reach YOUR banking /
 * processor / EMI provider. Configure it with three values and it WILL call the
 * provider — there is no dry-run, no simulation and no silent local fallback.
 *
 *   PROVIDER_ENDPOINT_URL  e.g. https://api.yourprovider.com
 *   PROVIDER_API_KEY       sent as X-Provider-Key (or Bearer token)
 *   PROVIDER_SECRET_KEY    used to HMAC-sign every request body
 *
 * Fail-closed contract:
 *   - If any of the three values is missing/invalid, `assertConfigured()`
 *     throws PROVIDER_NOT_CONFIGURED and the engine refuses to run. It never
 *     fabricates a "verified" result when the provider was not contacted.
 *   - Every call is a real, signed HTTP request. Network / non-2xx errors are
 *     raised as ProviderCallError with the provider's response attached.
 */

import axios, { AxiosRequestConfig } from 'axios';
import crypto from 'crypto';

export const PROVIDER_NOT_CONFIGURED = 'PROVIDER_NOT_CONFIGURED';
export const PROVIDER_CALL_FAILED = 'PROVIDER_CALL_FAILED';

export class ProviderNotConfiguredError extends Error {
  code = PROVIDER_NOT_CONFIGURED;
  missing: string[];
  constructor(missing: string[]) {
    super(
      `Provider is not configured. Set ${missing.join(', ')} so the engine can call the provider.`,
    );
    this.name = 'ProviderNotConfiguredError';
    this.missing = missing;
  }
}

export class ProviderCallFailedError extends Error {
  code = PROVIDER_CALL_FAILED;
  status?: number;
  responseBody?: unknown;
  endpoint: string;
  constructor(message: string, endpoint: string, status?: number, responseBody?: unknown) {
    super(message);
    this.name = 'ProviderCallFailedError';
    this.endpoint = endpoint;
    this.status = status;
    this.responseBody = responseBody;
  }
}

export interface ProviderConfig {
  endpointUrl: string;
  apiKey: string;
  secretKey: string;
  timeoutMs: number;
  authScheme: 'hmac' | 'bearer';
  signatureAlgorithm: 'sha256' | 'sha512';
  allowInsecureHttp: boolean;
}

export interface ProviderCallResult<T = any> {
  ok: boolean;
  status: number;
  data: T;
  endpoint: string;
  requestId: string | null;
  durationMs: number;
  signature: string;
}

export interface ProviderStatus {
  configured: boolean;
  missing: string[];
  endpointUrl: string | null;
  authScheme: ProviderConfig['authScheme'];
  signatureAlgorithm: ProviderConfig['signatureAlgorithm'];
  timeoutMs: number;
  keyFingerprint: string | null;
  lastError: string | null;
}

/** Read a provider path with an env override, e.g. PROVIDER_PATH_FUNDS_VERIFY. */
function providerPath(envKey: string, fallback: string): string {
  const raw = String(process.env[envKey] || '').trim();
  const path = raw || fallback;
  return path.startsWith('/') ? path : `/${path}`;
}

function isPlaceholderHost(hostname: string): boolean {
  return /^(your[-_.]?provider|example\.com|example\.org|changeme|provider\.local)$/i.test(hostname)
    || /your[-_.]?provider|example\.com/i.test(hostname);
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export class ProviderClient {
  private lastError: string | null = null;

  /** Reads the environment every time so a Render redeploy picks up new values. */
  readConfig(): ProviderConfig {
    const endpointUrl = String(process.env.PROVIDER_ENDPOINT_URL || '').trim().replace(/\/+$/, '');
    const apiKey = String(process.env.PROVIDER_API_KEY || '').trim();
    const secretKey = String(process.env.PROVIDER_SECRET_KEY || '').trim();
    const authScheme = String(process.env.PROVIDER_AUTH_SCHEME || 'hmac').trim().toLowerCase() === 'bearer'
      ? 'bearer'
      : 'hmac';
    const signatureAlgorithm = String(process.env.PROVIDER_SIGNATURE_ALGORITHM || 'sha512').trim().toLowerCase() === 'sha256'
      ? 'sha256'
      : 'sha512';
    const timeoutRaw = Number(process.env.PROVIDER_TIMEOUT_MS || 20000);
    const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 20000;
    const allowInsecureHttp = ['1', 'true', 'on', 'yes'].includes(
      String(process.env.PROVIDER_ALLOW_INSECURE_HTTP || '').trim().toLowerCase(),
    );
    return { endpointUrl, apiKey, secretKey, timeoutMs, authScheme, signatureAlgorithm, allowInsecureHttp };
  }

  /** Returns the list of missing/invalid settings. Empty array == ready. */
  missingSettings(): string[] {
    const cfg = this.readConfig();
    const missing: string[] = [];
    if (!cfg.apiKey) missing.push('PROVIDER_API_KEY');
    if (!cfg.secretKey) missing.push('PROVIDER_SECRET_KEY');
    if (!cfg.endpointUrl) {
      missing.push('PROVIDER_ENDPOINT_URL');
      return missing;
    }
    let url: URL;
    try {
      url = new URL(cfg.endpointUrl);
    } catch {
      missing.push('PROVIDER_ENDPOINT_URL (must be an absolute URL)');
      return missing;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      missing.push('PROVIDER_ENDPOINT_URL (must be http/https)');
    }
    if (isPlaceholderHost(url.hostname)) {
      missing.push('PROVIDER_ENDPOINT_URL (placeholder host)');
    }
    if (url.protocol === 'http:' && !cfg.allowInsecureHttp && !isLoopback(url.hostname)) {
      missing.push('PROVIDER_ENDPOINT_URL (https required, or set PROVIDER_ALLOW_INSECURE_HTTP=true)');
    }
    return missing;
  }

  isConfigured(): boolean {
    return this.missingSettings().length === 0;
  }

  /** Throws ProviderNotConfiguredError when the provider is not wired. */
  assertConfigured(): ProviderConfig {
    const missing = this.missingSettings();
    if (missing.length) throw new ProviderNotConfiguredError(missing);
    return this.readConfig();
  }

  status(): ProviderStatus {
    const cfg = this.readConfig();
    const missing = this.missingSettings();
    const fingerprint = cfg.apiKey
      ? `${cfg.apiKey.slice(0, 5)}***${cfg.apiKey.slice(-4)}`
      : null;
    return {
      configured: missing.length === 0,
      missing,
      endpointUrl: cfg.endpointUrl || null,
      authScheme: cfg.authScheme,
      signatureAlgorithm: cfg.signatureAlgorithm,
      timeoutMs: cfg.timeoutMs,
      keyFingerprint: fingerprint,
      lastError: this.lastError,
    };
  }

  private sign(cfg: ProviderConfig, method: string, path: string, timestamp: string, rawBody: string): string {
    const base = `${timestamp}.${method.toUpperCase()}.${path}.${rawBody}`;
    return crypto.createHmac(cfg.signatureAlgorithm, cfg.secretKey).update(base, 'utf8').digest('hex');
  }

  private buildHeaders(cfg: ProviderConfig, method: string, path: string, rawBody: string, idempotencyKey?: string) {
    const timestamp = new Date().toISOString();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Provider-Timestamp': timestamp,
    };
    if (cfg.authScheme === 'bearer') {
      headers.Authorization = `Bearer ${cfg.apiKey}`;
    } else {
      headers['X-Provider-Key'] = cfg.apiKey;
    }
    const signature = this.sign(cfg, method, path, timestamp, rawBody);
    headers[`X-Provider-Signature-Alg`] = cfg.signatureAlgorithm;
    headers['X-Provider-Signature'] = `${cfg.signatureAlgorithm}=${signature}`;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    return { headers, signature, timestamp };
  }

  /**
   * Perform a signed request. Always a real HTTP call when configured.
   */
  async call<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    options: { body?: unknown; query?: Record<string, string | number | undefined | null>; idempotencyKey?: string } = {},
  ): Promise<ProviderCallResult<T>> {
    const cfg = this.assertConfigured();
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${cfg.endpointUrl}${normalizedPath}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value === undefined || value === null || value === '') continue;
        url.searchParams.set(key, String(value));
      }
    }
    const rawBody = options.body === undefined ? '' : JSON.stringify(options.body);
    const { headers, signature } = this.buildHeaders(cfg, method, normalizedPath, rawBody, options.idempotencyKey);

    const request: AxiosRequestConfig = {
      method,
      url: url.toString(),
      headers,
      timeout: cfg.timeoutMs,
      validateStatus: () => true,
    };
    if (method !== 'GET' && method !== 'DELETE' && rawBody) request.data = rawBody;

    const startedAt = Date.now();
    let response;
    try {
      response = await axios.request(request);
    } catch (error: any) {
      this.lastError = error?.message || 'provider unreachable';
      throw new ProviderCallFailedError(
        `Provider request to ${url.toString()} failed: ${error?.message || 'network error'}`,
        url.toString(),
        undefined,
        undefined,
      );
    }
    const durationMs = Date.now() - startedAt;
    const responseHeaders: any = response.headers || {};
    const requestId =
      responseHeaders['x-request-id'] ||
      responseHeaders['x-provider-request-id'] ||
      (response.data && typeof response.data === 'object' ? ((response.data as any).request_id || (response.data as any).requestId) : null) ||
      null;

    if (response.status < 200 || response.status >= 300) {
      this.lastError = `HTTP ${response.status}`;
      throw new ProviderCallFailedError(
        `Provider returned HTTP ${response.status} for ${url.toString()}`,
        url.toString(),
        response.status,
        response.data,
      );
    }
    this.lastError = null;
    return {
      ok: true,
      status: response.status,
      data: (response.data ?? {}) as T,
      endpoint: url.toString(),
      requestId: requestId ? String(requestId) : null,
      durationMs,
      signature,
    };
  }

  // ── Provider contract (paths overridable via PROVIDER_PATH_* env vars) ──────

  verifyFunds(payload: Record<string, unknown>, idempotencyKey?: string) {
    return this.call('POST', providerPath('PROVIDER_PATH_FUNDS_VERIFY', '/funds/verify'), {
      body: payload,
      idempotencyKey,
    });
  }

  fetchBankStatement(query: Record<string, string | number | undefined | null>) {
    return this.call('GET', providerPath('PROVIDER_PATH_BANK_STATEMENTS', '/bank/statements'), { query });
  }

  fetchReserveReport(query: Record<string, string | number | undefined | null>) {
    return this.call('GET', providerPath('PROVIDER_PATH_RESERVE_REPORT', '/reports/reserve'), { query });
  }

  fetchSettlementReport(query: Record<string, string | number | undefined | null>) {
    return this.call('GET', providerPath('PROVIDER_PATH_SETTLEMENT_REPORT', '/reports/settlement'), { query });
  }

  fetchAccountStatement(accountId: string, query: Record<string, string | number | undefined | null>) {
    const template = providerPath('PROVIDER_PATH_ACCOUNT_STATEMENT', '/accounts/{accountId}/statement');
    return this.call('GET', template.replace('{accountId}', encodeURIComponent(accountId)), { query });
  }
}

export const providerClient = new ProviderClient();
