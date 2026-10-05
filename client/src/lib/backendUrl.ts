type ResolveApiBaseUrlOptions = {
  envValue?: string;
  currentOrigin?: string;
  localFallback?: string;
  windowLike?: {
    location?: { hostname?: string; origin?: string };
    localStorage?: { getItem?: (key: string) => string | null };
  };
};

export function resolveApiBaseUrl(options: ResolveApiBaseUrlOptions = {}) {
  const envValue = (options.envValue ?? '').trim();
  const localFallback = (options.localFallback ?? 'http://localhost:7000').replace(/\/$/, '');
  const normalizeLocalUrl = (value: string) => {
    const normalized = value.replace(/\/$/, '');
    try {
      const parsed = new URL(normalized);
      if (
        parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
        !parsed.port
      ) {
        parsed.port = '7000';
        return parsed.toString().replace(/\/$/, '');
      }
    } catch {
      // Preserve invalid values for the caller to report.
    }
    return normalized;
  };

  if (envValue) {
    return normalizeLocalUrl(envValue);
  }

  const windowLike = options.windowLike ?? (typeof window !== 'undefined' ? window : undefined);
  const hostname = windowLike?.location?.hostname ?? '';
  const storageValue = windowLike?.localStorage?.getItem?.('pos_backend_url')?.trim() ?? '';

  if (storageValue) {
    return normalizeLocalUrl(storageValue);
  }

  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '';
  if (isLocalHost) {
    return localFallback;
  }

  const currentOrigin = (options.currentOrigin ?? windowLike?.location?.origin ?? '').replace(/\/$/, '');
  if (currentOrigin) {
    // If the frontend is served on port 7001 (dev server), the backend is on port 7000
    try {
      const parsed = new URL(currentOrigin);
      if (parsed.port === '7001') {
        parsed.port = '7000';
        return parsed.toString().replace(/\/$/, '');
      }
    } catch { /* ignore */ }
    return currentOrigin;
  }

  return `https://${hostname}`;
}
