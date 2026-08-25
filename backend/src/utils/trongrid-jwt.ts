/**
 * TronGrid JWT Token Generator
 * 
 * When JWT is enabled on TronGrid dashboard, all API requests must include
 * a valid JWT token in the Authorization header.
 * 
 * Setup:
 * 1. Go to https://www.trongrid.io/dashboard
 * 2. Enable JWT for your API key
 * 3. Save the JWT Secret (shown only once!)
 * 4. Add to .env: TRON_JWT_SECRET=your_secret_here
 */

import jwt from 'jsonwebtoken';

/**
 * Generate a JWT token for TronGrid API
 * 
 * Token format expected by TronGrid:
 * {
 *   "iss": "your_api_key",
 *   "exp": expiration_timestamp,
 *   "iat": issued_at_timestamp
 * }
 * 
 * @param apiKey - Your TronGrid API key
 * @param jwtSecret - Your TronGrid JWT secret
 * @param expiresIn - Token expiration time (default: 1 hour)
 * @returns JWT token string
 */
export function generateTronGridJWT(
  apiKey: string,
  jwtSecret: string,
  expiresIn: string = '1h'
): string {
  if (!apiKey || !jwtSecret) {
    throw new Error('TronGrid API key and JWT secret are required');
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + parseExpiresIn(expiresIn);

  const payload = {
    iss: apiKey,
    iat: now,
    exp: exp,
  };

  const token = jwt.sign(payload, jwtSecret, {
    algorithm: 'HS256',
  });

  return token;
}

/**
 * Parse expiration string to seconds
 * Supports: '1h', '30m', '24h', etc.
 */
function parseExpiresIn(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match) {
    return 3600; // default 1 hour
  }

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 3600;
    case 'd':
      return value * 86400;
    default:
      return 3600;
  }
}

/**
 * Create a TronGrid JWT token manager with auto-refresh
 * 
 * Usage:
 * ```typescript
 * const jwtManager = createTronGridJWTManager(apiKey, jwtSecret);
 * 
 * // Get current valid token (auto-generates if expired)
 * const token = jwtManager.getToken();
 * 
 * // Use in API requests
 * fetch('https://api.trongrid.io/wallet/getbalance', {
 *   headers: {
 *     'Authorization': `Bearer ${token}`,
 *     'TRON-PRO-API-KEY': apiKey
 *   }
 * });
 * ```
 */
export function createTronGridJWTManager(apiKey: string, jwtSecret: string) {
  let currentToken: string | null = null;
  let tokenExpiry: number = 0;

  return {
    /**
     * Get current valid token, generating new one if expired
     */
    getToken(): string {
      const now = Math.floor(Date.now() / 1000);
      
      // Generate new token if current one doesn't exist or is expired (with 5min buffer)
      if (!currentToken || now >= tokenExpiry - 300) {
        currentToken = generateTronGridJWT(apiKey, jwtSecret, '1h');
        tokenExpiry = now + 3600; // 1 hour from now
        
        console.log('[TronGrid JWT] Generated new token, expires in 1 hour');
      }

      return currentToken;
    },

    /**
     * Force token refresh
     */
    refreshToken(): string {
      currentToken = generateTronGridJWT(apiKey, jwtSecret, '1h');
      tokenExpiry = Math.floor(Date.now() / 1000) + 3600;
      
      console.log('[TronGrid JWT] Forced token refresh');
      return currentToken;
    },

    /**
     * Get headers for TronGrid API request
     */
    getHeaders(): Record<string, string> {
      const token = this.getToken();
      return {
        'Authorization': `Bearer ${token}`,
        'TRON-PRO-API-KEY': apiKey,
        'Content-Type': 'application/json',
      };
    },
  };
}

/**
 * Example usage and testing
 */
export function testTronGridJWT() {
  const apiKey = process.env.TRON_API_KEY || '';
  const jwtSecret = process.env.TRON_JWT_SECRET || '';

  if (!apiKey || !jwtSecret) {
    console.error('[TronGrid JWT Test] Missing TRON_API_KEY or TRON_JWT_SECRET in .env');
    return;
  }

  console.log('[TronGrid JWT Test] Generating test token...');
  
  try {
    const token = generateTronGridJWT(apiKey, jwtSecret);
    console.log('[TronGrid JWT Test] ✅ Token generated successfully');
    console.log('[TronGrid JWT Test] Token preview:', token.substring(0, 50) + '...');
    
    // Decode without verification to show payload
    const decoded = jwt.decode(token);
    console.log('[TronGrid JWT Test] Token payload:', JSON.stringify(decoded, null, 2));
    
    // Test manager
    const manager = createTronGridJWTManager(apiKey, jwtSecret);
    const managerToken = manager.getToken();
    console.log('[TronGrid JWT Test] ✅ Manager token generated');
    
    // Test headers
    const headers = manager.getHeaders();
    console.log('[TronGrid JWT Test] ✅ Request headers ready');
    console.log('[TronGrid JWT Test] Headers:', JSON.stringify(headers, null, 2));
    
    return { token, headers, manager };
  } catch (error: any) {
    console.error('[TronGrid JWT Test] ❌ Error:', error.message);
    throw error;
  }
}
