type ResolveApiBaseUrlOptions = {
  envValue?: string;
  currentOrigin?: string;
  localFallback?: string;
  windowLike?: {
    location?: { hostname?: string };
    localStorage?: { getItem?: (key: string) => string | null };
  };
};

export function resolveApiBaseUrl(options: ResolveApiBaseUrlOptions = {}) {
  const envValue = (options.envValue ?? '').trim();
  const localFallback = (options.localFallback ?? 'http://localhost:7000').replace(/\/$/, '');

  if (envValue) {
    return envValue.replace(/\/$/, '');
  }

  const windowLike = options.windowLike ?? (typeof window !== 'undefined' ? window : undefined);
  const hostname = windowLike?.location?.hostname ?? '';
  const storageValue = windowLike?.localStorage?.getItem?.('pos_backend_url')?.trim() ?? '';

  if (storageValue) {
    return storageValue.replace(/\/$/, '');
  }

  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '';
  if (isLocalHost) {
    return localFallback;
  }

  const currentOrigin = (options.currentOrigin ?? windowLike?.location?.origin ?? '').replace(/\/$/, '');
  if (currentOrigin) {
    return currentOrigin;
  }

  return `https://${hostname}`;
}
