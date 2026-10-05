const requests = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;

export function checkRateLimit(apiKey: string): boolean {
  const now = Date.now();
  const timestamps = (requests.get(apiKey) || []).filter((timestamp) => now - timestamp < WINDOW_MS);
  if (timestamps.length >= MAX_REQUESTS) {
    requests.set(apiKey, timestamps);
    return false;
  }
  timestamps.push(now);
  requests.set(apiKey, timestamps);
  return true;
}

