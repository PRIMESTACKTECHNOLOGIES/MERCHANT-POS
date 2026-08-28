# 📱 STEP-BY-STEP: Build APK in Android Studio

## Complete Guide for Beginners

---

## 🎯 BEFORE YOU START - Checklist

Make sure you have:
- [ ] Android Studio installed ([Download here](https://developer.android.com/studio))
- [ ] Your PC's IP address
- [ ] Backend server ready to run
- [ ] Android phone (for testing)

### Find Your IP Address (Write this down!)
```powershell
ipconfig | findstr "IPv4"
```
**Your IP:** `192.168.1.160` ✏️ Write this down!

---

## 🚀 STEP 1: Open Android Studio

### 1.1 Launch Android Studio
1. Click **Start Menu** → Search "Android Studio"
2. Click on **Android Studio** app
3. Wait for it to load (first time takes 1-2 minutes)

### 1.2 Open the Project
1. Click **File** (top left)
2. Click **Open...**
3. Navigate to:
   ```
   C:\Users\user\Desktop\POS OFFLINE SFTWR\android_pos_app
   ```
4. Click the **android_pos_app** folder ONCE to select it
5. Click **OK**

![Expected: Project opens and starts loading]

### 1.3 Wait for Gradle Sync
⚠️ **IMPORTANT:** This takes 2-5 minutes the first time!

You'll see at the bottom:
```
Gradle: Build Running...
Gradle: Syncing...
```

Wait until you see:
```
Gradle sync finished in Xs
```

✅ **GREEN CHECKMARK** means success!

---

## 🔧 STEP 2: Update Server IP Address

This is CRITICAL - the app needs to know where your server is!

### 2.1 Open the Config File
1. In Android Studio, look at the **Project** panel on the LEFT
2. If you don't see it, click **View** → **Tool Windows** → **Project**
3. Navigate to this folder structure:
   ```
   android_pos_app
   └── app
       └── src
           └── main
               └── java
                   └── com
                       └── pos2013
                           └── offline
                               └── config
                                   └── GatewayConfig.kt
   ```
4. **Double-click** `GatewayConfig.kt` to open it

### 2.2 Edit the IP Address
Look for line 13:
```kotlin
private const val DEFAULT_SERVER_URL = "http://192.168.1.160:3000/"
```

**If it shows a different IP (like 192.168.1.100 or 3002):**
1. Change it to YOUR IP (from Step 1)
2. Make sure it ends with `:3000/`
3. Press **Ctrl+S** to save

**Example:**
```kotlin
// If your IP is 192.168.1.160
private const val DEFAULT_SERVER_URL = "http://192.168.1.160:3000/"

// If your IP is 192.168.1.100  
private const val DEFAULT_SERVER_URL = "http://192.168.1.100:3000/"
```

✅ **File should show dot (●) next to name if changed, disappears when saved**

---

## 🏗️ STEP 3: Build the APK

### Method A: Build Debug APK (Recommended for testing)

1. Click **Build** in top menu
2. Click **Build Bundle(s) / APK(s)**
3. Click **Build APK(s)**

![Menu: Build → Build Bundle(s) / APK(s) → Build APK(s)]

### 3.1 Wait for Build
You'll see at the bottom:
```
Gradle: Executing tasks: [:app:assembleDebug]
```

Wait 2-5 minutes...

When done, you'll see a popup:
```
🎉 APK(s) generated successfully!
[locate] [Show in Explorer]
```

### 3.2 Find Your APK
Click **"Show in Explorer"** or navigate to:
```
C:\Users\user\Desktop\POS OFFLINE SFTWR\android_pos_app\app\build\outputs\apk\debug\
```

The file is named: **`app-debug.apk`**

✅ **This is your APK file!**

---

### Method B: Build Release APK (For production/play store)

⚠️ **Only do this if Method A works!**

1. Click **Build** → **Generate Signed Bundle / APK...**
2. Select **APK**
3. Click **Next**
4. Under **Key store path**, click **Create new...**
5. Fill in:
   - Key store path: Choose location, name it `pos-release-key.jks`
   - Password: Create a password (remember it!)
   - Key alias: `poskey`
   - Key password: Same as above
   - Validity: 25 years
   - Certificate: Fill your name/organization
6. Click **OK**
7. Click **Next**
8. Select **release**
9. Click **Finish**

APK location:
```
C:\Users\user\Desktop\POS OFFLINE SFTWR\android_pos_app\app\release\
```

---

## 📲 STEP 4: Transfer APK to Phone

### Method 1: USB Cable (Easiest)

1. **Connect phone to PC** with USB cable
2. On phone, select **"File Transfer"** or **"MTP"** mode
3. Open **File Explorer** on PC
4. Find your phone in "This PC"
5. Navigate to **Downloads** folder
6. Copy `app-debug.apk` from PC to phone's Downloads

### Method 2: Email

1. Attach `app-debug.apk` to email
2. Send to yourself
3. Open email on phone
4. Download attachment

### Method 3: Google Drive / Dropbox

1. Upload `app-debug.apk` to Google Drive
2. Open Google Drive app on phone
3. Download the file

---

## 🔓 STEP 5: Enable "Unknown Sources" on Phone

⚠️ **REQUIRED** - Android blocks apps from outside Play Store by default

### For Android 8.0+ (Oreo and newer):

1. Open **Settings**
2. Go to **Apps**
3. Find and tap **Files** or **File Manager** (or Chrome if downloading)
4. Tap **Install unknown apps**
5. Toggle **Allow from this source** → **ON**

### For Android 7.0 and older:

1. Open **Settings**
2. Go to **Security**
3. Find **Unknown Sources**
4. Toggle **ON**
5. Tap **OK** on warning

---

## 📱 STEP 6: Install the APK

1. Open **File Manager** app on phone
2. Navigate to **Downloads** folder
3. Find **`app-debug.apk`**
4. **Tap** on it
5. Tap **Install**
6. Wait for installation
7. Tap **Open** or find "POS 201.3" app in your apps

✅ **App is now installed!**

---

## 🧪 STEP 7: Test the App

### Before Testing:
1. **Start backend server** on your PC:
   ```powershell
   cd "C:\Users\user\Desktop\POS OFFLINE SFTWR\backend"
   npm run dev
   ```
2. **Make sure phone and PC are on same WiFi**

### Test Steps:
1. Open **POS 201.3** app on phone
2. You should see the **Setup Screen**
3. Enter these settings:
   - **Merchant ID:** `MRC-1001`
   - **Terminal ID:** `TERM001` (or auto-generated)
   - **Server URL:** `http://192.168.1.160:3000/` (your IP!)
   - **Secret Key:** `sk_test_default_key_123`
4. Tap **Register Device**
5. Should show: ✅ "Device registered successfully!"

### Test Payment:
1. Enter Code: `123456`
2. Enter Amount: `100`
3. Tap **Process Payment**
4. Should show: ✅ "Payment Successful!"

🎉 **SUCCESS! Everything works!**

---

## 🐛 TROUBLESHOOTING

### Problem: "Gradle sync failed"

**Solution 1: Check internet connection**
- Gradle needs internet to download dependencies

**Solution 2: Update Gradle**
1. Click **File** → **Project Structure**
2. Click **SDK Location**
3. Make sure Android SDK path is set
4. Click **OK**

**Solution 3: Invalidate caches**
1. Click **File** → **Invalidate Caches / Restart...**
2. Select **Invalidate and Restart**
3. Wait for restart

---

### Problem: "Build failed" or red errors

**Solution 1: Check IP address is correct**
- Must be `http://YOUR_IP:3000/`
- Must end with `/`

**Solution 2: Check keystore file exists**
1. Check if file exists:
   ```
   C:\Users\user\Desktop\POS OFFLINE SFTWR\android_pos_app\pos-release-key.keystore
   ```
2. If missing, build DEBUG version instead (Method A)

**Solution 3: Check Java version**
1. Click **File** → **Settings**
2. Go to **Build, Execution, Deployment** → **Build Tools** → **Gradle**
3. Make sure "Gradle JDK" is set to Java 17

---

### Problem: "App not installed" on phone

**Solution 1: Unknown Sources**
- Make sure "Unknown Sources" is enabled (Step 5)

**Solution 2: Existing app**
- Uninstall old version first
- Long press app icon → Uninstall

**Solution 3: Different signature**
- If you had debug version, uninstall before installing release
- Or vice versa

---

### Problem: "Connection failed" or "Network error"

**Solution 1: Check backend running**
- Look at PowerShell - should say "Server running on port 3000"

**Solution 2: Check IP address**
1. On PC, run: `ipconfig`
2. Make sure app has the correct IP
3. Rebuild APK if you changed it

**Solution 3: Same WiFi**
- Phone and PC MUST be on same WiFi network
- Check phone WiFi settings

**Solution 4: Firewall**
Run this in PowerShell (as Admin):
```powershell
New-NetFirewallRule -DisplayName "POS Backend" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

---

### Problem: "Invalid credentials" on registration

**Solution:**
- Make sure you're using: `sk_test_default_key_123`
- Or generate new key from Dashboard → Developer API Keys

---

## 📋 QUICK CHECKLIST

Before building:
- [ ] Android Studio installed
- [ ] Project opened (`android_pos_app`)
- [ ] Gradle sync completed (green checkmark)
- [ ] IP address updated in `GatewayConfig.kt`
- [ ] File saved (Ctrl+S)

After building:
- [ ] APK file found in `app/build/outputs/apk/debug/`
- [ ] APK copied to phone
- [ ] Unknown Sources enabled
- [ ] App installed successfully
- [ ] Backend server running
- [ ] Phone and PC on same WiFi
- [ ] Test payment works!

---

## 🎥 WHAT EACH SCREEN LOOKS LIKE

### Android Studio - Project Opened
```
┌─────────────────────────────────────────────────────┐
│  android_pos_app  [app]                    □ □ ×   │
├─────────────────────────────────────────────────────┤
│  Project  │                                         │
│  ▼ app    │   GatewayConfig.kt                     │
│    ▼ src  │   ─────────────────                    │
│      ▼ main│   private const val...                │
│        ▼ java│                                     │
│          ▼ com│  DEFAULT_SERVER_URL =              │
│            ▼ pos2013│  "http://192.168.1.160:3000/"│
│              ▼ offline│                            │
│                config│                             │
│                  GatewayConfig.kt                   │
│                                                     │
│  Build: Gradle sync finished ✓                      │
└─────────────────────────────────────────────────────┘
```

### Build Menu
```
Build
├── Make Project                    Ctrl+F9
├── Clean Project
├── Rebuild Project
├── Build Bundle(s) / APK(s)   ← CLICK THIS
│   └── Build APK(s)           ← THEN THIS
├── Generate Signed Bundle / APK...
└──...
```

### Success Popup
```
╔═══════════════════════════════════════╗
║  🎉 APK(s) generated successfully!    ║
║                                        ║
║  [     Locate      ] [ Show in... ]  ║
╚═══════════════════════════════════════╝
```

---

## 💾 APK FILE LOCATIONS

| Build Type | Location |
|------------|----------|
| **Debug** | `app\build\outputs\apk\debug\app-debug.apk` |
| **Release** | `app\release\app-release.apk` |

---

## 📞 NEED MORE HELP?

**Review these files:**
- `EASIEST_WAY_TO_BUILD_APK.md` - Alternative methods
- `PHYSICAL_ANDROID_SETUP.md` - Phone setup details
- `ANDROID_APP_SETUP_GUIDE.md` - Complete documentation

**Check:**
1. Is backend running? (`npm run dev`)
2. Is IP address correct? (`ipconfig`)
3. Is Gradle sync complete? (green checkmark)
4. Is phone on same WiFi?

---

**Good luck! You've got this!** 🚀

---

*Created: March 8, 2026*  
*For: POS Offline Software - Android App Build*
