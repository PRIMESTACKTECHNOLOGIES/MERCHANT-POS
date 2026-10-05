import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { Request, Response } from 'express';

const VALIDATION_TIMEOUT_MS = 10_000;

function ipv4ToNumber(address: string): number {
  return address.split('.').reduce((value, octet) => (value * 256) + Number(octet), 0) >>> 0;
}

function ipv4InRange(address: string, network: string, prefixLength: number): boolean {
  const value = ipv4ToNumber(address);
  const networkValue = ipv4ToNumber(network);
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (value & mask) === (networkValue & mask);
}

function expandIpv6(address: string): number[] | null {
  const normalized = address.toLowerCase().split('%')[0];
  const ipv4Match = normalized.match(/(.+):(\d+\.\d+\.\d+\.\d+)$/);
  const withIpv4Expanded = ipv4Match
    ? `${ipv4Match[1]}:${(ipv4ToNumber(ipv4Match[2]) >>> 16).toString(16)}:${(ipv4ToNumber(ipv4Match[2]) & 0xffff).toString(16)}`
    : normalized;
  const halves = withIpv4Expanded.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const parts = [
    ...left.map((p) => parseInt(p, 16)),
    ...Array.from({ length: missing }, () => 0),
    ...right.map((p) => parseInt(p, 16)),
  ];
  return parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 0xffff) ? parts : null;
}

function ipv6InRange(address: string, prefix: number[], prefixLength: number): boolean {
  const value = expandIpv6(address);
  if (!value) return true;
  const fullWords = Math.floor(prefixLength / 16);
  const remainingBits = prefixLength % 16;
  for (let i = 0; i < fullWords; i++) {
    if (value[i] !== prefix[i]) return false;
  }
  if (remainingBits === 0) return true;
  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return (value[fullWords] & mask) === (prefix[fullWords] & mask);
}

function isPrivateAddress(address: string, family: 4 | 6): boolean {
  const unwrapped = address.replace(/^\[|\]$/g, '');
  if (family === 4) {
    return [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
      ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
    ].some(([network, prefix]) => ipv4InRange(unwrapped, network as string, prefix as number));
  }
  const prefixRanges: Array<[string, number]> = [
    ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10],
    ['ff00::', 8], ['2001:db8::', 32],
  ];
  return prefixRanges.some(([network, prefixLength]) =>
    ipv6InRange(unwrapped, expandIpv6(network) || [], prefixLength)
  );
}

async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  const addresses = results.map((r) => ({ address: r.address, family: r.family as 4 | 6 }));
  if (!addresses.length) throw new Error('Could not resolve hostname');
  const publicAddresses = addresses.filter((a) => !isPrivateAddress(a.address, a.family));
  return publicAddresses[0] || addresses[0];
}

/**
 * Probe the endpoint using axios — sends credentials in headers and body.
 */
async function probeEndpoint(
  targetUrl: URL,
  apiKey: string,
  apiSecret: string,
): Promise<{ status: number; body: string; ok: boolean }> {
  const axios = (await import('axios')).default;

  try {
    const resp = await axios.post(targetUrl.toString(), { action: 'verify', apiKey, timestamp: Date.now() }, {
      timeout: VALIDATION_TIMEOUT_MS,
      maxRedirects: 3,
      validateStatus: () => true,
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-API-Key':     apiKey,
        'X-API-Secret':  apiSecret,
        'X-Secret-Key':  apiSecret,
        'User-Agent':    'PRIMESTACK-POS-Validator/1.0',
      },
    });

    const bodyStr = typeof resp.data === 'string'
      ? resp.data.slice(0, 500)
      : JSON.stringify(resp.data).slice(0, 500);

    return { status: resp.status, body: bodyStr, ok: resp.status >= 200 && resp.status < 300 };
  } catch (err: any) {
    throw new Error(err?.message || 'Request failed');
  }
}

/**
 * Interpret provider response to determine if credentials are valid.
 */
function interpretProviderResponse(status: number, body: string): {
  credentialsConfirmed: boolean;
  verified: boolean;
  reason: string;
} {
  let parsed: any = {};
  try { parsed = JSON.parse(body); } catch { /* plain text */ }

  if (status === 401 || status === 403) {
    return { credentialsConfirmed: false, verified: false, reason: `Credentials rejected by provider (HTTP ${status})` };
  }
  if (status === 404) {
    return { credentialsConfirmed: false, verified: false, reason: 'Endpoint path not found (HTTP 404) — check the URL' };
  }
  if (status >= 500) {
    return { credentialsConfirmed: false, verified: false, reason: `Provider server error (HTTP ${status}) — endpoint may be down` };
  }
  if (status === 405) {
    return { credentialsConfirmed: false, verified: false, reason: 'Endpoint does not accept POST — try a different URL path' };
  }
  if (status >= 300 && status < 400) {
    return { credentialsConfirmed: false, verified: false, reason: `Endpoint redirected (HTTP ${status}) — use the final destination URL` };
  }

  if (status >= 200 && status < 300) {
    // Check for explicit failure in body
    const hasExplicitFailure =
      parsed?.error === true || parsed?.success === false || parsed?.ok === false ||
      ['FAILED','REJECTED','INVALID','UNAUTHORIZED'].includes(String(parsed?.status || '').toUpperCase());

    if (hasExplicitFailure) {
      return {
        credentialsConfirmed: false,
        verified: false,
        reason: `Endpoint reachable but credentials rejected: ${parsed?.message || parsed?.error || 'see provider response'}`,
      };
    }

    // Check for explicit success
    const hasExplicitSuccess =
      parsed?.success === true || parsed?.ok === true ||
      parsed?.verified === true || parsed?.authenticated === true ||
      ['OK','SUCCESS','AUTHENTICATED','VERIFIED','ACTIVE'].includes(String(parsed?.status || '').toUpperCase());

    if (hasExplicitSuccess) {
      return { credentialsConfirmed: true, verified: true, reason: `Provider confirmed credentials valid (HTTP ${status})` };
    }

    // 2xx with no explicit signal — accepted
    return {
      credentialsConfirmed: true,
      verified: true,
      reason: `Endpoint reachable and accepted the request (HTTP ${status}) — credentials appear valid`,
    };
  }

  return { credentialsConfirmed: false, verified: false, reason: `Unexpected HTTP ${status} from provider` };
}

export async function validateIntegrationEndpoint(req: Request, res: Response) {
  const { apiKey, apiSecret, endpointUrl } = req.body || {};

  if (typeof apiKey !== 'string' || !apiKey.trim() ||
      typeof apiSecret !== 'string' || !apiSecret.trim() ||
      typeof endpointUrl !== 'string' || !endpointUrl.trim()) {
    return res.status(400).json({
      verified: false, reachable: false, credentialsConfirmed: false,
      reason: 'API key, API secret, and endpoint URL are all required',
    });
  }

  let url: URL;
  try {
    url = new URL(endpointUrl.trim());
  } catch {
    return res.status(400).json({
      verified: false, reachable: false, credentialsConfirmed: false,
      reason: 'Endpoint URL is not valid — include the full URL with https://',
    });
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return res.status(400).json({
      verified: false, reachable: false, credentialsConfirmed: false,
      reason: 'Endpoint URL must start with https://',
    });
  }

  if (url.username || url.password) {
    return res.status(400).json({
      verified: false, reachable: false, credentialsConfirmed: false,
      reason: 'Do not embed credentials in the URL — use the API key and secret fields',
    });
  }

  // DNS resolution check (skip for localhost/IP)
  try {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const family = isIP(hostname);
    if (!family) {
      await resolvePublicAddress(hostname);
    }
  } catch (error: any) {
    return res.status(200).json({
      verified: false, reachable: false, credentialsConfirmed: false,
      reason: `Cannot resolve hostname: ${error?.message || 'DNS lookup failed'}`,
    });
  }

  try {
    const probe = await probeEndpoint(url, apiKey.trim(), apiSecret.trim());
    const interpretation = interpretProviderResponse(probe.status, probe.body);
    console.log(`[IntegrationValidate] ${url.hostname} → HTTP ${probe.status} | verified=${interpretation.verified}`);
    return res.status(200).json({
      verified:             interpretation.verified,
      reachable:            true,
      credentialsConfirmed: interpretation.credentialsConfirmed,
      httpStatus:           probe.status,
      reason:               interpretation.reason,
    });
  } catch (error: any) {
    const isTimeout = error?.message?.toLowerCase().includes('timeout');
    return res.status(200).json({
      verified: false, reachable: false, credentialsConfirmed: false,
      reason: isTimeout
        ? `Endpoint did not respond within ${VALIDATION_TIMEOUT_MS / 1000} seconds`
        : `Endpoint unreachable: ${error?.message || 'connection failed'}`,
    });
  }
}
