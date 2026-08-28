import axios from 'axios';
import { randomUUID } from 'crypto';

export interface CustomCryptoPurchaseResult {
  ok: boolean;
  provider: string;
  asset: string;
  amount_usd: number;
  executed_qty: number;
  status?: string;
  order_id?: string;
  raw?: any;
}

export async function purchaseCryptoWithCustomApi(asset: string, amountUsd: number, merchantId?: string): Promise<CustomCryptoPurchaseResult> {
  const provider = (process.env.CUSTOM_CRYPTO_PROVIDER || 'local').toLowerCase();
  const customApiUrl = process.env.CUSTOM_CRYPTO_API_URL?.trim();

  if (provider === 'external' && customApiUrl) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.CUSTOM_CRYPTO_API_KEY) headers['X-API-Key'] = process.env.CUSTOM_CRYPTO_API_KEY;

    const payload = {
      merchant_id: merchantId || 'unknown',
      asset: asset.toUpperCase(),
      amount_usd: amountUsd,
      source: 'pos'
    };

    const res = await axios.post(customApiUrl, payload, { headers, timeout: 10000 });
    const executedQty = Number(res.data?.executed_qty ?? res.data?.executedQty ?? 0);
    return {
      ok: true,
      provider: 'external-custom-api',
      asset: res.data?.asset || payload.asset,
      amount_usd: Number(res.data?.amount_usd ?? amountUsd),
      executed_qty: executedQty,
      status: res.data?.status || 'accepted',
      order_id: res.data?.order_id || res.data?.orderId || randomUUID(),
      raw: res.data
    };
  }

  throw new Error('Live crypto provider is not configured. Set CUSTOM_CRYPTO_PROVIDER=external and CUSTOM_CRYPTO_API_URL to a real exchange endpoint.');
}

export default { purchaseCryptoWithCustomApi };
