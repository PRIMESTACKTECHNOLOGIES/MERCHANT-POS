# 📱 How to Connect POS App to Dashboard

## Quick Start Guide

### Step 1: Start the Backend Server

Open PowerShell and run:
```powershell
cd "C:\Users\user\Desktop\POS OFFLINE SFTWR\backend"
npm run dev
```

You should see:
```
Server running on port 3000
```

### Step 2: Get Your Laptop's IP Address

Run this in PowerShell:
```powershell
ipconfig | findstr "IPv4"
```

Look for your WiFi adapter (usually starts with `192.168.x.x`):
```
IPv4 Address. . . . . . . . . . . : 192.168.1.100
```

**Your Server URL will be:** `http://192.168.1.100:3000/`

### Step 3: Open the Dashboard

Open browser and go to:
```
http://localhost:5173/
```

**Login with:**
- Username: `admin`
- Password: `admin123`

### Step 4: Get Your API Key

1. In Dashboard, go to **"Developer API Keys"**
2. Click **"Regenerate API Key"**
3. Copy the key (starts with `sk_live_...` or `sk_test_...`)

### Step 5: Install & Configure the App

1. Install APK on your phone: `POS-2013-Final-v3.apk`
2. Open the app
3. On the **Setup Screen**, enter:

| Field | Value | Example |
|-------|-------|---------|
| **Merchant ID** | Your merchant ID | `MERCHANT123` |
| **Terminal ID** | Auto-generated | `TERM-A1B2C3D4` |
| **Server URL** | Your laptop IP | `http://192.168.1.100:3000/` |
| **Secret Key** | API Key from dashboard | `sk_live_...` |

4. Tap **"Register Device"**
5. App will verify credentials and connect!

---

## 🔧 Troubleshooting

### "Cannot connect to server"

**Check 1:** Is backend running?
- Look at the PowerShell window - should show "Server running on port 3000"

**Check 2:** Same WiFi network?
- Your phone and laptop must be on the same WiFi

**Check 3:** Firewall blocking?
- Allow port 3000 in Windows Firewall:
```powershell
# Run as Administrator
New-NetFirewallRule -DisplayName "POS Backend" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

**Check 4:** Wrong IP address?
- Run `ipconfig` again - IP might have changed
- Update the Server URL in app

### "Invalid credentials"

- Make sure you copied the API key correctly
- Key should be from Developer API Keys section
- No extra spaces before/after

### "Device already registered"

- Logout from app and re-register
- Or delete app data and start fresh

---

## 🔄 How It Works

```
┌──────────────────┐     WiFi      ┌──────────────────┐
│   Android POS    │ ─────────────→ │  Laptop Backend  │
│    App           │    Same        │  Port: 3000      │
│                  │   Network      │                  │
│ 1. Collects card │                │ 2. Verifies      │
│    payment data  │                │    merchant      │
│                  │                │                  │
│ 3. Stores locally│                │ 3. Saves to      │
│    (SQLite)      │ ←─────────────→│    database      │
│                  │   When online  │                  │
│ 4. Syncs when    │                │ 4. Shows in      │
│    internet OK   │ ─────────────→ │    Dashboard     │
└──────────────────┘                └──────────────────┘
```

---

## 📝 Important Notes

### About Payment Methods

| Method | Works Offline? | Protocol 201.3? |
|--------|---------------|-----------------|
| **Visa** | ✅ Yes | ✅ Yes |
| **Mastercard** | ✅ Yes | ✅ Yes |
| **American Express** | ✅ Yes | ✅ Yes |
| **UnionPay** | ✅ Yes | ✅ Yes |
| **Apple Pay** | ❌ No | ❌ No |
| **Google Pay** | ❌ No | ❌ No |
| **Alipay** | ❌ No | ❌ No |

**Only card-based payments support offline!** Digital wallets require internet.

### The 6-Digit Codes

| Code | When Generated | Purpose |
|------|---------------|---------|
| **STAN** (000042) | When customer pays | Track transaction on device |
| **Settlement Code** (456789) | When batch syncs | Proof server received data |

---

## 🎯 Quick Test

1. **Start backend** on laptop
2. **Connect app** with correct settings
3. **Process a test payment** (use fake card: 4111111111111111)
4. **Check Dashboard** → Transactions page should show it!

---

## ❓ Need Help?

If still having issues:
1. Check backend is running: `http://YOUR_IP:3000/` should show "POS 201.3 Backend Running"
2. Try opening dashboard in phone browser first
3. Make sure phone and laptop are on same WiFi
4. Restart both backend and try again
