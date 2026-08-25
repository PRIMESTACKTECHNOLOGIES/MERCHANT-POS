# 🔐 TronGrid JWT Authentication Setup Guide

## ✅ What Is JWT on TronGrid?

JWT (JSON Web Token) authentication adds an extra layer of security to your TronGrid API access:

- **Without JWT**: Only API key required (less secure)
- **With JWT**: API key + signed JWT token required (more secure)

## 🎯 Benefits of Enabling JWT

✅ **Enhanced Security**: Tokens expire, API keys don't  
✅ **Prevent Abuse**: Harder for attackers to use stolen keys  
✅ **Rate Limit Protection**: Better control over API usage  
✅ **Audit Trail**: Track token generation and usage  
✅ **Production Ready**: Industry best practice  

## ⚠️ Important: What Happens When You Enable JWT

Once enabled on TronGrid dashboard:
1. **ALL requests MUST include JWT token** in `Authorization: Bearer <token>` header
2. **Existing code will fail** if not updated to use JWT
3. **Cannot disable JWT easily** once enabled
4. **Must save JWT secret** (shown only once!)

---

## 📋 Step-by-Step Setup

### Step 1: **Access Your TronGrid Dashboard**

1. Go to: https://www.trongrid.io/dashboard
2. Log in with your account
3. Navigate to your API key details page
4. Or use direct link: https://www.trongrid.io/dashboard/detail/416638

### Step 2: **Copy Your Current API Key**

Before enabling JWT, save your API key:
- Find **"API Key"** field on dashboard
- Copy the key (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
- Keep it safe!

### Step 3: **Enable JWT Authentication**

On the TronGrid dashboard page:

1. Locate the **"Enable JWT"** option/toggle
2. Read the warning message:
   ```
   After JWT is enabled, the JWTs of all requests have to be validated.
   Are you sure to enable it?
   ```
3. ✅ Click **"Enable"** or **"Confirm"**
4. **⚠️ IMPORTANT**: A **JWT Secret** will be displayed **ONLY ONCE**
5. **COPY AND SAVE** the JWT Secret immediately!
   - Format: Long random string (e.g., `abc123def456...`)
   - You cannot view it again after closing the page!

### Step 4: **Update Your Backend `.env` File**

Open: `backend\.env`

Find the TRON section and update these values:

```env
# ── TRON (TRC-20 USDT) ───────────────────────────────────────────────────────
#   - Fund address with ~25 TRX for gas (20 TRX minimum enforced by code).
#   - Fund address with USDT TRC-20 for liquidity.
#   - TronGrid JWT: Enable on dashboard for enhanced security (recommended for production)
TRON_PRIVATE_KEY=FAA595C6197FCC01A901B8497CF631276541651E0D66ED8E4D24EC9BA854EEA7
TRON_WALLET_ADDRESS=TFZXzaXXgk3uCcCWbUWKZAydsc95D8GZBP
TRON_API_KEY=your_trongrid_api_key_here
TRON_JWT_SECRET=your_trongrid_jwt_secret_here
TRON_FULL_NODE=https://api.trongrid.io
```

**Replace**:
- `your_trongrid_api_key_here` → Your actual API key from Step 2
- `your_trongrid_jwt_secret_here` → JWT secret from Step 3

**Example**:
```env
TRON_API_KEY=a1b2c3d4-e5f6-7890-abcd-ef1234567890
TRON_JWT_SECRET=7d8a9b0c1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b
```

### Step 5: **Test JWT Configuration**

Create a test script to verify JWT is working:

```bash
cd backend
node -e "require('./dist/utils/trongrid-jwt').testTronGridJWT()"
```

**Expected output**:
```
[TronGrid JWT Test] Generating test token...
[TronGrid JWT Test] ✅ Token generated successfully
[TronGrid JWT Test] Token preview: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
[TronGrid JWT Test] Token payload: {
  "iss": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "iat": 1724515200,
  "exp": 1724518800
}
[TronGrid JWT Test] ✅ Manager token generated
[TronGrid JWT Test] ✅ Request headers ready
[TronGrid JWT Test] Headers: {
  "Authorization": "Bearer eyJhbGci...",
  "TRON-PRO-API-KEY": "a1b2c3d4-...",
  "Content-Type": "application/json"
}
```

### Step 6: **Restart Your Backend**

```bash
cd backend
npm run dev
```

**Look for this message** in console:
```
[TronGrid] JWT authentication enabled ✅
```

### Step 7: **Test a Real Transaction**

Make a test USDT transfer or check balance:

**Check Balance**:
```bash
# From your POS application
# Go to Hot Wallet → Overview → Check USDT balance
```

**Expected**: Balance loads successfully with no errors

**If you see errors**:
- Check backend logs for JWT-related errors
- Verify API key and JWT secret are correct in `.env`
- Ensure JWT is actually enabled on TronGrid dashboard

---

## 🔧 How JWT Works in Your System

### Automatic JWT Generation

Your system now automatically:

1. **Generates JWT tokens** when needed
2. **Refreshes tokens** before they expire (1 hour lifetime)
3. **Includes tokens** in all TronGrid API requests
4. **Falls back** to API key only if JWT not configured

### Token Lifecycle

```
Start Application
      ↓
Check .env for TRON_JWT_SECRET
      ↓
If JWT Secret found:
      ↓
Generate JWT token (valid 1 hour)
      ↓
Store in memory
      ↓
Use in all API requests
      ↓
Auto-refresh before expiry (55 min mark)
      ↓
Loop ↺
```

### Request Headers

**Without JWT** (legacy):
```http
POST https://api.trongrid.io/wallet/triggersmartcontract
TRON-PRO-API-KEY: a1b2c3d4-e5f6-7890-abcd-ef1234567890
Content-Type: application/json
```

**With JWT** (new):
```http
POST https://api.trongrid.io/wallet/triggersmartcontract
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
TRON-PRO-API-KEY: a1b2c3d4-e5f6-7890-abcd-ef1234567890
Content-Type: application/json
```

---

## 🚨 Troubleshooting

### Issue 1: "JWT Secret Not Found"

**Error in logs**:
```
[TronGrid] JWT authentication enabled ✅
... (missing)
```

**Solution**:
1. Check `backend\.env` file
2. Verify `TRON_JWT_SECRET=...` is set
3. Ensure no extra spaces or quotes
4. Restart backend

---

### Issue 2: "401 Unauthorized" from TronGrid

**Error**:
```
Request failed with status code 401
```

**Causes**:
1. **JWT not enabled on dashboard** but code expects it
2. **Wrong JWT secret** in `.env`
3. **Token expired** (shouldn't happen with auto-refresh)

**Solutions**:

#### Option A: Verify JWT is enabled
1. Go to TronGrid dashboard
2. Check if JWT toggle is ON
3. If OFF, either enable it OR remove `TRON_JWT_SECRET` from `.env`

#### Option B: Regenerate JWT Secret
1. Go to TronGrid dashboard
2. Disable JWT
3. Re-enable JWT
4. Copy NEW secret (old one invalidated)
5. Update `.env` with new secret
6. Restart backend

---

### Issue 3: "403 Forbidden" from TronGrid

**Error**:
```
Request failed with status code 403
```

**Causes**:
1. **API Key invalid or expired**
2. **Rate limit exceeded**
3. **IP address blocked**

**Solutions**:
1. Verify API key in dashboard
2. Check rate limits (free tier: 300 req/min)
3. Consider upgrading TronGrid plan
4. Check if IP is whitelisted (if IP restrictions enabled)

---

### Issue 4: "Token Format Invalid"

**Error in logs**:
```
[TronGrid] Error generating JWT: ...
```

**Solutions**:
1. Verify JWT secret has no spaces or newlines
2. Check secret is the exact string from dashboard
3. Ensure secret is not wrapped in quotes in `.env`:
   ```env
   # ❌ Wrong
   TRON_JWT_SECRET="abc123..."
   
   # ✅ Correct
   TRON_JWT_SECRET=abc123...
   ```

---

### Issue 5: "Cannot Find Module 'jsonwebtoken'"

**Error**:
```
Error: Cannot find module 'jsonwebtoken'
```

**Solution**:
```bash
cd backend
npm install jsonwebtoken
npm install --save-dev @types/jsonwebtoken
```

---

## 🔍 Debugging JWT

### Check if JWT is Active

Add this to your code temporarily:

```typescript
// In backend/src/exchange/tronweb.service.ts
console.log('[Debug] TRON_JWT_SECRET set:', !!process.env.TRON_JWT_SECRET);
console.log('[Debug] TRON_API_KEY set:', !!process.env.TRON_API_KEY);
```

**Expected output**:
```
[Debug] TRON_JWT_SECRET set: true
[Debug] TRON_API_KEY set: true
```

### Manual JWT Test

Create `test-jwt.ts`:

```typescript
import { generateTronGridJWT } from './backend/src/utils/trongrid-jwt';

const apiKey = 'your_api_key_here';
const jwtSecret = 'your_jwt_secret_here';

try {
  const token = generateTronGridJWT(apiKey, jwtSecret);
  console.log('✅ JWT Token:', token);
} catch (error) {
  console.error('❌ Error:', error.message);
}
```

Run:
```bash
npx ts-node test-jwt.ts
```

---

## 📊 JWT Token Structure

Your JWT tokens contain:

```json
{
  "iss": "your_api_key",      // Issuer (your API key)
  "iat": 1724515200,           // Issued at (timestamp)
  "exp": 1724518800            // Expires at (1 hour later)
}
```

**Signature**: HMAC-SHA256 using your JWT secret

---

## ✅ Verification Checklist

Before going live with JWT:

- [ ] JWT enabled on TronGrid dashboard
- [ ] JWT secret saved securely
- [ ] `TRON_API_KEY` set in `.env`
- [ ] `TRON_JWT_SECRET` set in `.env`
- [ ] Backend restarts successfully
- [ ] Console shows "JWT authentication enabled ✅"
- [ ] Test balance check works
- [ ] Test transaction works
- [ ] No 401/403 errors in logs
- [ ] JWT tokens auto-refresh (check after 55 min)

---

## 🔄 Disabling JWT (If Needed)

### To Temporarily Disable:

**Option 1**: Remove from `.env`
```env
# TRON_JWT_SECRET=...  (comment out)
```

**Option 2**: Keep in `.env` but disable on dashboard
1. Go to TronGrid dashboard
2. Disable JWT toggle
3. System will fall back to API key only

### ⚠️ Warning:
Once JWT is enabled on TronGrid and you have live transactions, **do not disable it** without coordinating with your team. Disabling JWT will require updating production credentials.

---

## 📞 Support Resources

### TronGrid Documentation
- Dashboard: https://www.trongrid.io/dashboard
- API Docs: https://developers.tron.network/reference/api-overview
- Support: support@tron.network

### Your Implementation Files
- JWT Utils: `backend/src/utils/trongrid-jwt.ts`
- Tron Service: `backend/src/exchange/tronweb.service.ts`
- Config: `backend/.env`

---

## 🎯 Production Recommendations

### Security Best Practices:

1. ✅ **Always enable JWT** in production
2. ✅ **Rotate JWT secret** quarterly
3. ✅ **Monitor token generation** in logs
4. ✅ **Set up alerts** for 401/403 errors
5. ✅ **Use environment-specific secrets** (staging vs production)
6. ✅ **Never commit `.env` files** to git
7. ✅ **Backup JWT secret** in secure vault (1Password, Vault, etc.)

### Rate Limiting:

**Free Tier**: 300 requests/minute  
**Paid Tier**: 1000+ requests/minute

**Monitor your usage**:
- Check dashboard for current rate limit status
- Implement retry logic for 429 errors (already done!)
- Consider caching balance checks

---

## 📝 Summary

### What We Did:

1. ✅ Added `TRON_JWT_SECRET` to `.env`
2. ✅ Created JWT utility (`trongrid-jwt.ts`)
3. ✅ Updated Tron service to use JWT
4. ✅ Automatic token generation and refresh
5. ✅ Backward compatible (falls back to API key only if no JWT)

### What You Need to Do:

1. **Go to TronGrid dashboard**: https://www.trongrid.io/dashboard/detail/416638
2. **Enable JWT authentication**
3. **Copy the JWT Secret** (shown only once!)
4. **Update `.env`** with API key and JWT secret
5. **Restart backend**
6. **Test your system**

### After Setup:

- ✅ All API requests automatically include JWT tokens
- ✅ Tokens auto-refresh every hour
- ✅ Enhanced security for your TronGrid API access
- ✅ Production-ready authentication

---

**Last Updated**: August 24, 2026  
**Version**: 1.0  
**Status**: ✅ Ready to Enable

---

## 🎉 You're All Set!

Once you enable JWT on TronGrid dashboard and update your `.env`, your system will automatically use JWT authentication for all Tron API requests. No additional code changes needed! 🚀

**Questions?** Check the troubleshooting section or review the implementation files.
