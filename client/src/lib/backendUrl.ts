type ResolveApiBaseUrlOptions = {
  envValue?: string;
  currentOrigin?: string;
  localFallback?: string;
  windowLike?: {
    location?: { hostname?: string; origin?: string };
    localStorage?: { getItem?: (key: string) => string | null };
    // Allows injecting runtime config that backend emits into <head> of
    // index.html via <script id="__APP_CONFIG__">window.APP_CONFIG=...</script>
    // Render env VITE_API_URL / API_URL / APP_CONFIG_API_URL populates this
    // at server boot time so a Render env change + restart picks it up
    // WITHOUT needing a full Docker rebuild / Vite re-build of client.
    APP_CONFIG?: { api_url?: string };
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

  const windowLike = options.windowLike ?? (typeof window !== 'undefined' ? (window as any) : undefined);

  // Priority 1: per-browser user override from /developer page (localStorage)
  // Users explicitly setting this always want it respected above anything else.
  const storageValue = windowLike?.localStorage?.getItem?.('pos_backend_url')?.trim() ?? '';
  if (storageValue) {
    return normalizeLocalUrl(storageValue);
  }

  // Priority 2: backend-runtime-injected window.APP_CONFIG.api_url
  // Populated by backend/src/app.ts from env vars: API_URL / VITE_API_URL /
  // APP_CONFIG_API_URL, picked up at server boot inside Render / any other host.
  // Enables changing the frontend API origin WITHOUT a full client build.
  const winCfgValue = (windowLike?.APP_CONFIG?.api_url ?? '').toString().trim();
  if (winCfgValue) {
    return normalizeLocalUrl(winCfgValue);
  }

  // Priority 3: Vite build-time import.meta.env.VITE_API_URL
  // (Stale unless Vite actually runs during build, unlike the runtime case)
  if (envValue) {
    return normalizeLocalUrl(envValue);
  }

  const hostname = windowLike?.location?.hostname ?? '';

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
