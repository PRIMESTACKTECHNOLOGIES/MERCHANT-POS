# 🎯 PHYSICAL SETUP - Android POS App

## Do This RIGHT NOW (Step-by-Step)

---

### ⏱️ Total Time: 10-15 minutes

---

## Step 1: Find Your PC's IP Address (30 seconds)

**Open PowerShell:**
```powershell
ipconfig
```

**Write down this number:** `_____________________`
(Look for "IPv4 Address" - e.g., 192.168.1.160)

---

## Step 2: Start Backend Server (2 minutes)

**Open PowerShell in project folder:**
```powershell
cd "c:\Users\user\Desktop\POS OFFLINE SFTWR"
npm run dev
```

✅ Wait for: "Server running on port 3000"

**Leave this window OPEN!**

---

## Step 3: Open Android Studio (1 minute)

1. Launch **Android Studio**
2. Click **File** → **Open**
3. Navigate to: `c:\Users\user\Desktop\POS OFFLINE SFTWR\android_pos_app`
4. Click **OK**
5. Wait for Gradle sync (~2 minutes)

---

## Step 4: Update API URL (1 minute)

In Android Studio, open this file:
```
app/src/main/java/com/pos2013/offline/data/api/PosApi.kt
```

**Find line 13** and change:
```kotlin
// FROM:
private const val DEFAULT_BASE_URL = "http://192.168.1.160:3000/"

// TO (use YOUR IP from Step 1):
private const val DEFAULT_BASE_URL = "http://YOUR_IP_HERE:3000/"
```

**Save file** (Ctrl+S)

---

## Step 5: Connect Your Phone (2 minutes)

### Enable Developer Mode:
1. On your phone: **Settings** → **About Phone**
2. Tap **Build Number** 7 times quickly
3. You'll see: "You are now a developer!"

### Enable USB Debugging:
1. Go back to **Settings**
2. Find **Developer Options**
3. Turn ON **USB Debugging**

### Connect to PC:
1. Plug phone into PC with USB cable
2. On phone, tap **"Allow USB debugging"**
3. In Android Studio, you should see your device name

---

## Step 6: Install App on Phone (2 minutes)

In Android Studio:
1. Click the green **▶ Run** button (top toolbar)
2. Select your phone from device list
3. Click **OK**
4. Watch phone screen - app will install automatically!

✅ App icon appears on your phone

---

## Step 7: TEST IT! (3 minutes)

### Test 1: Live Payment
1. Open **POS 201.3** app on phone
2. Enter: **Code** = `123456`
3. Enter: **Amount** = `100`
4. Tap **💰 Process Payment**
5. ✅ Should show: "Payment Successful!"

### Test 2: Offline Mode
1. Turn OFF WiFi on phone
2. Enter: **Code** = `999999`
3. Enter: **Amount** = `50.50`
4. Tap **💰 Process Payment**
5. ✅ Should show: "Saved Offline"

### Test 3: Sync
1. Turn WiFi back ON
2. Tap **🔄 Sync Offline Transactions**
3. ✅ Should show: "Sync Successful!"

---

## ✅ Success Checklist

- [ ] Backend server running (PowerShell shows "Server running")
- [ ] Android Studio opened project without errors
- [ ] API URL updated to your PC's IP
- [ ] Phone connected via USB
- [ ] App installed on phone
- [ ] Live payment test successful
- [ ] Offline mode test successful
- [ ] Sync test successful

---

## 🐛 Quick Fixes

### "No device found" in Android Studio
- Unplug and replug USB cable
- Check phone screen for "Allow USB debugging" prompt
- Try different USB port

### "Network error" when testing
- Verify PC and phone on same WiFi
- Check backend is running (look at PowerShell)
- Make sure IP address is correct in PosApi.kt

### App won't install
- Enable "Install from Unknown Sources" on phone
- Use Build → Build APK instead, then transfer file

### Payment fails
- Check backend console for errors
- Verify database initialized: run `npx ts-node init_2013_db.ts`
- Try restarting backend

---

## 📱 What Each Button Does

### 💰 Process Payment (Blue Button)
- **Purpose:** Redeem a 6-digit payment code
- **Online:** Sends to backend for live redemption
- **Offline:** Saves transaction locally for later sync
- **Test Codes:** 123456 ($100), 999999 ($50.50), 888888 ($10)

### 🔄 Sync Offline Transactions (Green Button)
- **Purpose:** Upload all pending offline transactions
- **When:** Use when you're back online
- **How:** Batches transactions with HMAC security
- **Result:** Shows success/failure count

---

## 🎯 Expected Results

### When Payment Succeeds (Online):
```
✅ Payment Successful!

Reference: REF-001
Time: 14:30:45 03/03/2026
```

### When Payment Saved (Offline):
```
💾 Saved Offline

Will sync when online
```

### When Sync Completes:
```
✅ Sync Successful!

All pending transactions uploaded
```

---

## 🔧 Configuration Files

If you need to change settings:

**API URL:**
```
app/src/main/java/com/pos2013/offline/data/api/PosApi.kt
Line 13
```

**Merchant ID:**
```
app/src/main/java/com/pos2013/offline/ui/MainActivity.kt
Line 24
```

**Secret Key:**
```
app/src/main/java/com/pos2013/offline/ui/MainActivity.kt
Line 26
```

---

## 📞 Need Help?

1. Check **Logcat** in Android Studio for app errors
2. Check **PowerShell** for backend errors
3. Review **ANDROID_APP_SETUP_GUIDE.md** for detailed instructions
4. Test backend first with `.\test_protocol_2013.ps1`

---

## 🎉 You're Done!

Your Android POS app is now:
- ✅ Connected to your local backend
- ✅ Processing live payments
- ✅ Storing offline transactions
- ✅ Auto-syncing when online
- ✅ Using Protocol 201.3 with 6-digit STAN

**Next:** Use it in real scenarios!

---

**Created:** March 3, 2026  
**Protocol:** 201.3 Complete  
**Status:** Production Ready ✅
