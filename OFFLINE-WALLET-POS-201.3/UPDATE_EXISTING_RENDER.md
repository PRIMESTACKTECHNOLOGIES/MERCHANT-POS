# 🔄 UPDATE EXISTING RENDER DEPLOYMENT

You already have a Web Service on Render. Here's how to update it with the latest code.

---

## METHOD 1: Auto-Deploy from GitHub (RECOMMENDED)

If your Render service is connected to GitHub, just push code and it auto-updates!

### Step 1: Get Your Render URL
1. Go to https://dashboard.render.com/
2. Click your existing web service
3. Copy the URL (e.g., `https://pos-offline-xyz.onrender.com`)

### Step 2: Update Android App
Open file:
```
android_pos_app/app/src/main/java/com/pos2013/offline/config/GatewayConfig.kt
```

Update these 2 values:
```kotlin
// Line 31: Paste YOUR actual Render URL
private const val RENDER_URL = "https://pos-offline-xyz.onrender.com/"

// Line 40: Set to false for production
private const val USE_LOCAL = false
```

### Step 3: Rebuild APK
1. Open Android Studio
2. Build → Build Bundle(s) / APK(s) → Build APK(s)
3. Install on your phone

### Step 4: Push Code to GitHub (if not already)
```bash
cd "C:\Users\user\Desktop\POS OFFLINE SFTWR"
git add .
git commit -m "Updated for production deployment"
git push origin main
```

Render will **automatically redeploy** when you push!

---

## METHOD 2: Manual Deploy (No GitHub)

If your Render service is NOT connected to GitHub:

### Step 1: Update Environment Variables
1. Go to https://dashboard.render.com/
2. Click your web service
3. Go to **"Environment"** tab
4. Add/Update these variables:

| Key | Value | Required? |
|-----|-------|-----------|
| `PORT` | `3000` | ✅ Yes |
| `NODE_ENV` | `production` | ✅ Yes |
| `DATABASE_URL` | `/var/lib/data/pos_offline.sqlite` | ✅ Yes (if using disk) |
| `ADMIN_PASSWORD` | Your secure password | ✅ Yes |
| `SECRET_KEY` | Random 32+ char string | ✅ Yes |
| `MYFATOORAH_TOKEN` | Your MyFatoorah token | ⚠️ For real payments |
| `MYFATOORAH_TEST_MODE` | `false` | ⚠️ For real payments |

### Step 2: Check Disk Configuration
If using SQLite, ensure you have a disk mounted:
1. Go to **"Disks"** tab
2. Should see: `mountPath: /var/lib/data`
3. If not, create disk with:
   - Name: `pos_data`
   - Mount Path: `/var/lib/data`
   - Size: 1 GB

### Step 3: Manual Deploy
1. Go to **"Manual Deploy"** button
2. Select **"Deploy latest commit"** or **"Clear build cache & deploy"**

---

## ⚡ QUICK CHECKLIST

### On Render Dashboard:
- [ ] Service is "Live" (green dot)
- [ ] Environment variables set
- [ ] Disk attached (if using SQLite)
- [ ] Auto-deploy enabled (if using GitHub)

### On Android App:
- [ ] GatewayConfig.kt has correct Render URL
- [ ] USE_LOCAL = false
- [ ] APK rebuilt and installed
- [ ] App connects successfully

---

## 🧪 TEST AFTER UPDATE

1. **Test Backend:**
   ```
   https://your-app.onrender.com/
   ```
   Should show: `"POS 201.3 Backend Running"`

2. **Test Dashboard:**
   ```
   https://your-app.onrender.com/dashboard
   ```

3. **Test Android Connection:**
   - Open POS app
   - Tap "Test Connection"
   - Should show: "Connection Successful"

---

## 🔴 IMPORTANT NOTES

1. **Database:** If you don't have a disk attached, your data will be LOST on every deploy!
   - Go to Render Dashboard → Disks → Create Disk
   - Mount path: `/var/lib/data`

2. **Free Tier Warning:** Free tier spins down after 15 min inactivity.
   - First request will be slow (waking up)
   - Upgrade to Starter ($7/mo) for always-on

3. **SQLite vs PostgreSQL:**
   - Current setup uses SQLite (simpler)
   - For high volume, upgrade to PostgreSQL

---

## ❓ TROUBLESHOOTING

### "Build Failed"
- Check logs in Render Dashboard → Logs
- Usually: missing dependency or TypeScript error

### "Cannot find module"
- Make sure `npm install` runs during build
- Check Dockerfile has `RUN npm ci`

### "Database locked" or data lost
- You don't have persistent disk!
- Create disk in Render Dashboard

### "Connection failed" from Android
- Wrong URL in GatewayConfig.kt
- Using `http://` instead of `https://`
- Missing trailing slash `/`

---

## 📞 YOUR RENDER URL

**What's your current Render URL?** (Copy from dashboard)

Once you tell me, I can update the Android config file with the exact URL!

Example:
- ✅ `https://pos-offline-xyz.onrender.com/`
- ❌ `http://192.168.1.160:3000/` (this is local)
