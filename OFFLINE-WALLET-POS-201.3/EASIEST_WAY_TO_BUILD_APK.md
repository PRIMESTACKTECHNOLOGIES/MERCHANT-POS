# 📱 EASIEST WAY - Install Android POS App

## Choose ONE Method:

---

## 🏆 **METHOD 1: Automated Build Script** (Recommended - 5 minutes)

### Step 1: Make Sure Backend is Running
```powershell
cd "c:\Users\user\Desktop\POS OFFLINE SFTWR"
npm run dev
```
✅ Keep this running!

---

### Step 2: Run Build Script
Double-click this file:
```
build_android_app.ps1
```

OR in PowerShell:
```powershell
.\build_android_app.ps1
```

---

### Step 3: Wait for Build (~3-5 minutes)
The script will:
- ✅ Find Gradle
- ✅ Build the APK
- ✅ Show you where it is

---

### Step 4: Transfer APK to Phone

**Option A: USB Cable**
1. Connect phone to PC with USB
2. Copy APK file to phone (Downloads folder)

**Option B: Email/Cloud**
1. Email APK to yourself
2. Download on phone
3. OR upload to Google Drive, download on phone

---

### Step 5: Install on Phone

1. On phone: **Settings** → **Security**
2. Enable **"Unknown Sources"** or **"Install unknown apps"**
3. Open **File Manager** on phone
4. Find the APK file
5. Tap to install
6. Open **POS 201.3** app!

---

### Step 6: Update IP Address (IMPORTANT!)

Before testing, you MUST update the API URL:

**In Android Studio:**
1. Open `android_pos_app` folder
2. Go to: `app/src/main/java/com/pos2013/offline/data/api/PosApi.kt`
3. Line 13: Change IP to YOUR PC's IP
   ```kotlin
   private const val DEFAULT_BASE_URL = "http://YOUR_IP:3000/"
   ```
4. Rebuild APK (Build → Build APK)
5. Reinstall on phone

**Find your IP:**
```powershell
ipconfig
```
(Look for IPv4 Address)

---

### Step 7: Test It!

1. Open app on phone
2. Enter Code: `123456`
3. Enter Amount: `100`
4. Tap **💰 Process Payment**
5. ✅ Success!

---

## 🥈 **METHOD 2: Android Studio** (If Method 1 fails)

### Step 1: Open Android Studio
1. Launch Android Studio
2. Click **File** → **Open**
3. Select folder: `android_pos_app`
4. Wait for Gradle sync

---

### Step 2: Update IP Address
1. Open: `app/src/main/java/com/pos2013/offline/data/api/PosApi.kt`
2. Line 13: Change to your PC's IP
   ```kotlin
   private const val DEFAULT_BASE_URL = "http://YOUR_IP:3000/"
   ```
3. Save (Ctrl+S)

---

### Step 3: Build APK
1. Click **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**
2. Wait 2-3 minutes
3. APK saved to: `android_pos_app/app/build/outputs/apk/debug/app-debug.apk`

---

### Step 4: Install on Phone
Same as Method 1, Steps 4-7

---

## 🥉 **METHOD 3: USB Debugging** (Advanced)

### Requirements:
- Android Studio installed
- USB cable
- Developer options enabled on phone

---

### Steps:

1. **Enable Developer Mode on Phone:**
   - Settings → About Phone
   - Tap "Build Number" 7 times
   - Go back → Developer Options
   - Turn ON "USB Debugging"

2. **Connect Phone to PC:**
   - USB cable
   - Allow USB debugging on phone

3. **In Android Studio:**
   - Open `android_pos_app` folder
   - Update IP address (Line 13 in PosApi.kt)
   - Click green ▶ Run button
   - Select your phone
   - App installs automatically!

---

## 🔧 Quick Reference

### Your PC's IP Address:
```powershell
ipconfig
```
Write it here: _____________________

### Backend Must Be Running:
```powershell
npm run dev
```

### Test Codes:
- `123456` → $100.00
- `999999` → $50.50
- `888888` → $10.00

---

## ❓ Troubleshooting

### "Unknown Sources" blocked?
- Settings → Security → Unknown Sources → Enable
- OR Settings → Apps → Chrome/File Manager → Install unknown apps → Allow

### APK won't install?
- Check Android version (need Android 7.0+)
- Try different file manager app
- Use USB debugging method instead

### Network error when testing?
- Verify PC and phone on same WiFi
- Check backend is running
- Confirm IP address is correct in PosApi.kt

### Can't find Gradle?
- Use METHOD 2 (Android Studio)
- Android Studio includes Gradle automatically

---

## 🎯 What You Need:

✅ Backend server running (`npm run dev`)  
✅ APK file built (from script or Android Studio)  
✅ IP address updated in PosApi.kt  
✅ Phone and PC on same WiFi  
✅ "Unknown Sources" enabled on phone  

---

## 📞 Still Stuck?

**Check these:**
1. Is backend running? (PowerShell should say "Server running")
2. Did you update IP address in PosApi.kt?
3. Are phone and PC on same WiFi?
4. Is "Unknown Sources" enabled?

**Review full guides:**
- `PHYSICAL_ANDROID_SETUP.md` - Detailed steps
- `ANDROID_APP_SETUP_GUIDE.md` - Complete documentation

---

**Created:** March 3, 2026  
**Method:** Automated Build  
**Status:** Ready to Deploy ✅
