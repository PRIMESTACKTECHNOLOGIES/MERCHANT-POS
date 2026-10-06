import type { CorsOptions } from 'cors';

export function buildCorsOptions(
  nodeEnv = process.env.NODE_ENV,
  originsSetting = process.env.ALLOWED_ORIGINS,
): CorsOptions {
  const configuredOrigins = (originsSetting || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const isProduction = nodeEnv === 'production';

  // Auto-allow Render.com domains so ALLOWED_ORIGINS is not required on Render
  const renderUrl = process.env.RENDER_EXTERNAL_URL?.trim();
  if (renderUrl && !configuredOrigins.includes(renderUrl)) {
    configuredOrigins.push(renderUrl);
  }
  // Also auto-allow common Render subdomain pattern
  const renderServiceName = process.env.RENDER_SERVICE_NAME?.trim();
  if (renderServiceName) {
    const renderDomain = `https://${renderServiceName}.onrender.com`;
    if (!configuredOrigins.includes(renderDomain)) configuredOrigins.push(renderDomain);
  }

  if (isProduction && configuredOrigins.length === 0) {
    // Fallback: allow same-origin (self) — safe for Render where frontend is served from same process
    configuredOrigins.push('*');
  }

  const allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : ['*'];
  return {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      // Allow any onrender.com subdomain automatically
      if (origin.endsWith('.onrender.com')) return callback(null, true);
      // Allow any netlify.app subdomain automatically
      if (origin.endsWith('.netlify.app')) return callback(null, true);
      return callback(new Error('CORS: origin not allowed'), false);
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Api-Key',
      'Idempotency-Key',
      'X-Signature',
      'X-Timestamp',
      'X-Nonce',
      'X-Merchant-Id',
      'X-Terminal-Id',
    ],
  };
}
