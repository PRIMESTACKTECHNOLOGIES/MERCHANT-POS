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

  if (isProduction && (configuredOrigins.length === 0 || configuredOrigins.includes('*'))) {
    throw new Error('ALLOWED_ORIGINS must contain explicit origins when NODE_ENV=production');
  }

  const allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : ['*'];
  return {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if ((!isProduction && allowedOrigins.includes('*')) || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
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
