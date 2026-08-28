# 📱 Android POS App - Complete Setup Guide

## ✅ What's Been Updated

Your Android POS app now includes:
- **Protocol 201.3** implementation
- **Live Payment Redemption** using 6-digit codes
- **Offline Transaction Storage** with auto-sync
- **Modern Material Design UI**
- **Real-time Status Updates**
- **Automatic 6-digit STAN generation**

---

## 🚀 Quick Setup (5 Steps)

### Step 1: Find Your PC's IP Address

Open PowerShell on your PC and run:
```powershell
ipconfig
```

Look for **IPv4 Address** (e.g., `192.168.1.160`)

**IMPORTANT:** Your phone and PC must be on the **same WiFi network**.

---

### Step 2: Update API URL

Open this file in Android Studio:
```
android_pos_app/app/src/main/java/com/pos2013/offline/data/api/PosApi.kt
```

Find line 13 and update the IP address:
```kotlin
private const val DEFAULT_BASE_URL = "http://YOUR_IP_HERE:3000/"
```

Example:
```kotlin
private const val DEFAULT_BASE_URL = "http://192.168.1.160:3000/"
```

---

### Step 3: Open Project in Android Studio

1. Open **Android Studio**
2. Click **File** → **Open**
3. Select folder: `android_pos_app`
4. Wait for Gradle sync to complete (~2 minutes)

---

### Step 4: Build and Run

**Option A: USB Debugging (Recommended)**

1. Enable **Developer Options** on your phone:
   - Settings → About Phone
   - Tap **Build Number** 7 times
2. Enable **USB Debugging**:
   - Settings → Developer Options → USB Debugging → ON
3. Connect phone to PC via USB
4. In Android Studio, click **Run** (green play button)
5. Select your device
6. App will install and launch!

**Option B: Generate APK**

1. In Android Studio: **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**
2. APK will be saved to: `android_pos_app/app/build/outputs/apk/debug/app-debug.apk`
3. Transfer APK to your phone
4. Install (enable "Install from Unknown Sources" if prompted)

---

### Step 5: Test the App

#### Test Live Payment:
1. Open app on phone
2. Enter Code: `123456`
3. Enter Amount: `100`
4. Tap **💰 Process Payment**
5. You should see: `✅ Payment Successful!`

#### Test Offline Mode:
1. Turn off WiFi on phone
2. Enter Code: `999999`
3. Enter Amount: `50.50`
4. Tap **💰 Process Payment**
5. Should save offline automatically
6. Turn WiFi back on
7. Tap **🔄 Sync Offline Transactions**

---

## 🎯 App Features

### 💳 Live Payment Processing
- Enter 6-digit payment code
- Enter amount
- Instant redemption via Protocol 201.3
- Shows reference number and timestamp

### 💾 Offline Transaction Storage
- Automatically saves when network unavailable
- Stores in local Room database
- Generates unique 6-digit STAN for each transaction
- Displays storage confirmation

### 🔄 Auto-Sync
- Upload pending transactions when online
- Batch upload with HMAC-SHA256 security
- Progress indicator during sync
- Success/failure feedback

### 📊 Real-time Status
- Connection status at top
- Last transaction amount display
- Network state monitoring
- Error handling with helpful messages

---

## 🔧 Configuration

### Backend URL
File: `app/src/main/java/com/pos2013/offline/data/api/PosApi.kt`
```kotlin
private const val DEFAULT_BASE_URL = "http://YOUR_PC_IP:3000/"
```

### Merchant Settings
File: `app/src/main/java/com/pos2013/offline/ui/MainActivity.kt`
```kotlin
repository = TransactionRepository(
    db.transactionDao(), 
    api, 
    "MERCHANT123",        // Your merchant ID
    "TERM001",            // Your terminal ID
    "MY_SUPER_SECRET_KEY_12345"  // Your secret key
)
```

---

## 🐛 Troubleshooting

### "Network Error" or "Connection Failed"

**Problem:** Can't connect to backend

**Solutions:**
1. ✅ Verify PC and phone are on same WiFi
2. ✅ Check firewall allows port 3000
3. ✅ Ensure backend is running: `npm run dev`
4. ✅ Try pinging PC from phone (use network analyzer app)

### "Invalid Signature"

**Problem:** HMAC signature mismatch

**Solutions:**
1. ✅ Verify secret key matches backend
2. ✅ Check timestamp is current
3. ✅ Ensure nonce is unique

### App Won't Install

**Problem:** Installation blocked

**Solutions:**
1. ✅ Enable "Install from Unknown Sources"
2. ✅ Use USB debugging method instead
3. ✅ Check Android version (requires Android 7.0+)

### Backend Not Responding

**Problem:** Server errors

**Solutions:**
1. ✅ Check backend console for errors
2. ✅ Verify database initialized: `npx ts-node init_2013_db.ts`
3. ✅ Restart backend server

---

## 📱 Screen Layout

```
┌─────────────────────────────────┐
│  POS 201.3 Terminal             │
│  📡 Ready - Protocol 201.3      │
├─────────────────────────────────┤
│  ┌───────────────────────────┐  │
│  │ 💳 Live Payment           │  │
│  │                           │  │
│  │ [ 6-Digit Code     ]      │  │
│  │ [ Amount (USD)     ]      │  │
│  │                           │  │
│  │ [💰 Process Payment]      │  │
│  └───────────────────────────┘  │
│                                 │
│  [🔄 Sync Offline Transactions] │
│                                 │
│  ┌───────────────────────────┐  │
│  │ 📋 Result                 │  │
│  │ Enter code and amount     │  │
│  │ to start                  │  │
│  └───────────────────────────┘  │
│                                 │
│  Protocol 201.3 • Offline       │
└─────────────────────────────────┘
```

---

## 🎨 UI Components

- **Material Design** cards
- **Outlined text fields** with monospace font
- **Large buttons** for easy touch
- **Status bar** with real-time updates
- **Result card** with detailed feedback
- **Blue/Green color scheme** (professional POS look)

---

## 📦 Dependencies Included

All dependencies are configured in `build.gradle.kts`:
- ✅ Retrofit 2.9.0 (API calls)
- ✅ Room 2.6.1 (local database)
- ✅ Kotlin Coroutines (async operations)
- ✅ Material Components (UI)
- ✅ WorkManager 2.9.0 (background sync)

---

## 🔐 Security Features

- **HMAC-SHA256** signatures for batch uploads
- **Secure storage** of sensitive data
- **HTTPS ready** (configure in production)
- **Token-based** authentication support

---

## 🎯 Testing Checklist

Before deploying:

- [ ] Backend server running
- [ ] API URL updated to your PC's IP
- [ ] Phone and PC on same WiFi
- [ ] Test live payment with code `123456`
- [ ] Test offline mode (turn off WiFi)
- [ ] Test sync functionality
- [ ] Verify STAN generation (check logs)
- [ ] Test error scenarios (wrong code, etc.)

---

## 🚀 Production Deployment

To prepare for production:

1. **Update API URL** to production server
2. **Change secret keys** to production values
3. **Enable HTTPS** in backend
4. **Build signed APK** (release build)
5. **Test thoroughly** on multiple devices
6. **Deploy to Play Store** or distribute internally

---

## 📞 Support

If you encounter issues:

1. Check Android Studio **Logcat** for errors
2. Verify backend console logs
3. Test API endpoints with Postman first
4. Review Protocol 201.3 documentation

---

## 🎉 Success Indicators

You'll know it's working when:

✅ App installs without errors  
✅ Live payment returns success message  
✅ Offline mode saves transactions  
✅ Sync uploads pending transactions  
✅ Status bar shows real-time updates  
✅ STAN codes generate correctly  

---

**Version:** 1.0 - Protocol 201.3  
**Last Updated:** March 3, 2026  
**Min Android:** 7.0 (API 24)  
**Target android:** 14 (API 34)
