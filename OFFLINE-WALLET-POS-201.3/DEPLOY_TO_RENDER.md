# 🚀 DEPLOY TO RENDER.COM - COMPLETE GUIDE

This guide will walk you through deploying your POS Offline System to Render.com for **real-world production use**.

---

## 📋 BEFORE YOU START

### What You'll Need:
- [ ] GitHub account (free)
- [ ] Render account (free to create, $7/month for production)
- [ ] Your POS project files ready
- [ ] Android Studio (to rebuild APK after deployment)

### Cost:
- **Starter Plan**: $7/month (required for persistent database storage)
- **Free Tier**: NOT recommended (loses data on restart)

---

## STEP 1: Push Code to GitHub

### 1.1 Initialize Git Repository (if not already done)
```bash
cd "C:\Users\user\Desktop\POS OFFLINE SFTWR"
git init
git add .
git commit -m "Production deployment ready"
```

### 1.2 Create GitHub Repository
1. Go to https://github.com/new
2. Repository name: `pos-offline-system`
3. Make it **Private** (recommended for production)
4. Click **Create repository**

### 1.3 Push to GitHub
```bash
git remote add origin https://github.com/YOUR_USERNAME/pos-offline-system.git
git branch -M main
git push -u origin main
```

---

## STEP 2: Deploy to Render

### 2.1 Create Render Account
1. Go to https://dashboard.render.com/
2. Sign up with GitHub (easiest)
3. Verify your email

### 2.2 Deploy Using Blueprint
1. In Render dashboard, click **"New +"**
2. Select **"Blueprint"**
3. Click **"Connect a repository"**
4. Select your `pos-offline-system` repo
5. Click **"Connect"**
6. Review the blueprint - it will read from `render.yaml`
7. Click **"Apply"**

### 2.3 Wait for Deployment
- Build takes ~3-5 minutes
- You'll see logs in real-time
- When you see `"Server running on port 3000"` - it's ready!

### 2.4 Get Your Render URL
After successful deployment:
1. Click on your service name
2. Copy the URL: `https://pos-offline-sftwr.onrender.com`
3. **Save this URL** - you'll need it for the Android app

---

## STEP 3: Update Android App with Production URL

### 3.1 Update GatewayConfig.kt
Open this file:
```
android_pos_app/app/src/main/java/com/pos2013/offline/config/GatewayConfig.kt
```

Change line 31:
```kotlin
// BEFORE:
private const val RENDER_URL = "https://pos-offline-sftwr.onrender.com/"

// AFTER (use YOUR actual Render URL):
private const val RENDER_URL = "https://pos-offline-xyz123.onrender.com/"
```

Also change line 40:
```kotlin
// BEFORE:
private const val USE_LOCAL = true

// AFTER:
private const val USE_LOCAL = false
```

### 3.2 Rebuild APK
1. Open Android Studio
2. File → Sync Project with Gradle Files
3. Build → Build Bundle(s) / APK(s) → Build APK(s)
4. Wait for "APK(s) generated successfully"
5. Click "locate" to find your APK

### 3.3 Install on Your POS Device
1. Uninstall the old POS app from your phone
2. Copy the new APK to your phone (USB, email, Drive)
3. Install the new APK
4. Open the app

---

## STEP 4: Configure Production Secrets

### 4.1 Update Environment Variables in Render
1. In Render dashboard, click your service
2. Go to **"Environment"** tab
3. Update these values:

| Variable | Current Value | New Value |
|----------|---------------|-----------|
| `ADMIN_PASSWORD` | `ChangeThisToStrongPassword123!` | Your secure admin password |
| `SECRET_KEY` | `your-jwt-secret-key...` | Generate new random string (32+ chars) |
| `MYFATOORAH_TOKEN` | (empty) | Your MyFatoorah API token |
| `MYFATOORAH_TEST_MODE` | `false` | `true` (testing) or `false` (LIVE) |

### 4.2 Generate Secure Keys
For `SECRET_KEY`, generate a random string:
```bash
# In PowerShell:
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
```

---

## STEP 5: Initialize Database

### 5.1 Access Render Shell
1. In Render dashboard, click your service
2. Click **"Shell"** tab
3. Run database initialization:

```bash
# Navigate to app directory
cd /app

# Run database initialization
node dist/init_db.js
```

### 5.2 Add Test Payment Codes (Optional)
```bash
# Access database
sqlite3 /var/lib/data/pos_offline.sqlite

# Add payment codes
INSERT INTO payment_codes (code, amount_minor, reference) VALUES 
('123456', 10000, 'TEST-100'),
('999999', 5050, 'TEST-50'),
('888888', 1000, 'TEST-10');

.quit
```

---

## STEP 6: Test Everything

### 6.1 Test Backend is Running
Open in browser:
```
https://your-app.onrender.com/
```
Should show: `"POS 201.3 Backend Running"`

### 6.2 Test Dashboard
```
https://your-app.onrender.com/dashboard
```
Login with your admin password

### 6.3 Test Android App Connection
1. Open POS app on phone
2. Use these settings:
   - **Server URL**: `https://your-app.onrender.com/`
   - **Merchant ID**: `MRC-1001`
   - **Secret Key**: `sk_test_default_key_123`
3. Tap **"Test Connection"**
4. Should show: **"Connection Successful"**

### 6.4 Test Payment
1. Enter code: `123456`
2. Enter amount: `100.00`
3. Tap **"Process Payment"**
4. Should show: **"Payment Successful"**

---

## STEP 7: Go LIVE with Real Payments (MyFatoorah)

### 7.1 Get MyFatoorah Account
1. Sign up at https://myfatoorah.com/
2. Complete business verification
3. Get your API token

### 7.2 Update Render with Live Token
1. In Render dashboard → Environment
2. Update `MYFATOORAH_TOKEN` with your live token
3. Set `MYFATOORAH_TEST_MODE` = `false`
4. Click **"Save Changes"**
5. Service will auto-redeploy

### 7.3 Update Android App
1. Open app Settings
2. Enter your MyFatoorah token
3. Disable "Test Mode"
4. Save settings

---

## 🔐 SECURITY CHECKLIST

Before going live, verify:

- [ ] Changed default `ADMIN_PASSWORD`
- [ ] Generated strong `SECRET_KEY`
- [ ] Using HTTPS (Render provides this)
- [ ] Database is on persistent disk
- [ ] MyFatoorah token is secured
- [ ] GitHub repo is Private
- [ ] Removed any test data

---

## 📱 DISTRIBUTING TO MULTIPLE POS DEVICES

### Option 1: Email APK
1. Email APK file to each device
2. Install on each POS terminal
3. Configure with same server URL

### Option 2: Google Drive
1. Upload APK to Google Drive
2. Share link with devices
3. Download and install

### Option 3: MDM (Enterprise)
For many devices, use Mobile Device Management:
- Microsoft Intune
- Google Workspace
- VMware Workspace ONE

---

## 🔄 UPDATING AFTER DEPLOYMENT

### To Update Backend:
```bash
# Make changes to code
git add .
git commit -m "Update: description"
git push origin main

# Render auto-deploys!
```

### To Update Android App:
1. Update versionCode in `app/build.gradle.kts`
2. Rebuild APK
3. Distribute to devices
4. Devices must reinstall (unless using Play Store)

---

## 🆘 TROUBLESHOOTING

### Issue: "Build Failed" on Render
**Solution:** Check logs in Render dashboard → Logs tab

### Issue: "Database locked" or data lost
**Solution:** Ensure you're on Starter plan (not Free). Free tier has no persistent storage.

### Issue: "Connection failed" from Android
**Solution:**
1. Check URL in GatewayConfig.kt matches Render URL exactly
2. Ensure `https://` not `http://`
3. Check trailing slash `/`
4. Rebuild APK after URL change

### Issue: "Payment failed"
**Solution:**
1. Check MyFatoorah token is valid
2. Check `MYFATOORAH_TEST_MODE` setting
3. Check Render logs for errors

---

## 📞 SUPPORT

### Render Support:
- Docs: https://render.com/docs
- Status: https://status.render.com/

### MyFatoorah Support:
- Portal: https://portal.myfatoorah.com/

---

## ✅ DEPLOYMENT COMPLETE!

Your POS system is now:
- ✅ Running on professional cloud infrastructure
- ✅ Accessible worldwide via HTTPS
- ✅ Processing real payments (with MyFatoorah)
- ✅ Backed by persistent database storage

**Next Steps:**
1. Train staff on using the POS app
2. Monitor transactions in the dashboard
3. Set up regular database backups
4. Consider adding more POS terminals

---

**Created:** March 2026  
**Version:** Production 1.0  
**Platform:** Render.com (Starter Plan)
