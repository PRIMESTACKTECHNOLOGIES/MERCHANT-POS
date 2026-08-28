const cache: Record<string, { balance: number; currency: string }> = {};
const queue: Array<{ op: string; payload: any; ts: number }> = [];

export function enqueue(op: string, payload: any): number {
  queue.push({ op, payload, ts: Date.now() });
  return queue.length;
}

export function cacheBalance(customerId: string, balance: number, currency: string) {
  cache[customerId] = { balance, currency };
}

export function getCachedBalance(customerId: string): { balance: number; currency: string } | null {
  return cache[customerId] ?? null;
}

export function applyLocalBalance(customerId: string, delta: number) {
  if (!cache[customerId]) return;
  cache[customerId].balance = Math.max(0, Number(cache[customerId].balance) + Number(delta));
}

export function pendingCount(): number {
  return queue.length;
}
