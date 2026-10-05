export async function uploadOfflinePinSale(endpoint: string, payload: any) {
  // endpoint example: https://backend.example.com/merchant/v1/payments/offline-pin
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data: unknown = await response.json();
    if (!response.ok) throw new Error(`Offline PIN sale upload failed with HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}
