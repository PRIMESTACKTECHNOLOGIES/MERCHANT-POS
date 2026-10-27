/**
 * HMAC-SHA256 signature generation for Protocol 201.3
 * Matches backend and Android app exactly
 */

function getBrowserSubtleCrypto(): SubtleCrypto {
  const webCrypto =
    (typeof window !== 'undefined' && window.crypto) ||
    (typeof self !== 'undefined' && (self as any).crypto) ||
    (typeof globalThis !== 'undefined' && (globalThis as any).crypto);

  if (!webCrypto || typeof webCrypto.subtle === 'undefined') {
    throw new Error(
      'Web Crypto API is unavailable in this browser/environment. Please use a modern browser on localhost or HTTPS.'
    );
  }

  return webCrypto.subtle;
}

export async function generateHmacSignature(
  protocolVersion: string,
  merchantId: string,
  terminalId: string,
  batchId: string,
  timestamp: number,
  nonce: string,
  transactionCount: number,
  secretKey: string
): Promise<string> {
  // Create payload - MUST match backend format exactly
  // Format: protocolVersion|merchantId|terminalId|batchId|timestamp|nonce|transactionCount
  const payload = `${protocolVersion}|${merchantId}|${terminalId}|${batchId}|${timestamp}|${nonce}|${transactionCount}`;
  
  // Generate HMAC-SHA256
  const encoder = new TextEncoder();
  const key = encoder.encode(secretKey);
  const data = encoder.encode(payload);
  
  const subtle = getBrowserSubtleCrypto();
  const cryptoKey = await subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await subtle.sign('HMAC', cryptoKey, data);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

export function generateNonce(): string {
  return Math.random().toString(36).substring(2, 18);
}

export function generateLocalTxnId(): string {
  return `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function generateStan(): string {
  const lastStan = parseInt(localStorage.getItem('dashboard_last_stan') || '0', 10);
  const newStan = (lastStan + 1) % 1000000;
  localStorage.setItem('dashboard_last_stan', newStan.toString());
  return newStan.toString().padStart(6, '0');
}

export function generateBatchId(): string {
  return `batch_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

export function generateTerminalId(): string {
  return `WEB-${Math.random().toString(36).substr(2, 8).toUpperCase()}`;
}
