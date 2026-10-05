export const POS_BRAND_NAME = process.env.POS_BRAND_NAME?.trim() || 'PRIME';
export const VAULT_DISPLAY_NAME = process.env.VAULT_DISPLAY_NAME?.trim() || 'ICICI';
export const POS_PROTOCOL_VERSION = '201.3';

export function transactionChannel(authMode?: string, batchId?: string): 'ONLINE' | 'OFFLINE' {
  const mode = String(authMode || '').toUpperCase();
  return mode.includes('OFFLINE') || String(batchId || '').toUpperCase().startsWith('OFFLINE-')
    ? 'OFFLINE'
    : 'ONLINE';
}
