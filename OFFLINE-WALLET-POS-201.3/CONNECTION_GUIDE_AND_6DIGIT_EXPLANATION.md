# 🔗 Connection Guide & 6-Digit Code Explanation

## ❌ IMPORTANT: The 6-Digit Code is NOT for App Setup!

**The 6-digit code (Settlement Code) is generated AFTER a transaction, NOT during setup!**

---

## 📱 How to Connect App to Dashboard (CORRECT FLOW)

### Step 1: Start Backend Server (On Laptop)

```powershell
cd "C:\Users\user\Desktop\POS OFFLINE SFTWR\backend"
npm run dev
```

You should see: `Server running on port 3000`

---

### Step 2: Get Your API Key (From Dashboard)

1. Open Dashboard: http://localhost:5173/
2. Login: `admin` / `admin123`
3. Go to **"Developer API Keys"**
4. Click **"Regenerate API Key"**
5. Copy the key (looks like: `sk_live_abc123...`)

**THIS IS YOUR SECRET KEY - NOT THE 6-DIGIT CODE!**

---

### Step 3: Install & Configure App

Install: `POS-2013-Fixed-v4.apk`

On the Setup Screen, enter ONLY these 4 things:

| Field | Example Value | Where to Get |
|-------|---------------|--------------|
| **Merchant ID** | `MERCHANT123` | From dashboard or create your own |
| **Terminal ID** | `TERM-A1B2C3D4` | Auto-generated, or use your own |
| **Server URL** | `http://192.168.1.100:3000/` | Your laptop's IP + `:3000/` |
| **Secret Key** | `sk_live_...` | From Developer API Keys page |

**⚠️ DO NOT enter any 6-digit code here!**

---

### Step 4: Register Device

Tap **"Register Device"**

If successful, you'll see: ✅ "Device registered successfully!"

---

## 🔢 What is the 6-Digit Code Then?

The 6-digit code appears **AFTER** you process a payment:

```
┌─────────────────────────────────────────┐
│         CUSTOMER PAYS $100              │
│              (Online)                   │
├─────────────────────────────────────────┤
│                                         │
│  1. Enter card in POS app               │
│  2. Tap "Process Payment"               │
│  3. App generates STAN: 000042          │
│  4. Payment stored locally              │
│                                         │
│  5. Auto-sync to server                 │
│  6. Server responds with:               │
│     "Settlement Code: 456789"           │
│                                         │
│  7. Receipt shows BOTH:                 │
│     - STAN: 000042                      │
│     - Settlement: 456789                │
│                                         │
└─────────────────────────────────────────┘
```

### Where You See the Codes:

| Code | When | Where Shown | Purpose |
|------|------|-------------|---------|
| **STAN** (000042) | At payment | App screen, receipt | Track transaction |
| **Settlement Code** (456789) | After sync | App screen, receipt, dashboard | Proof of processing |

---

## ❓ Common Confusion

### WRONG Understanding:
```
"I need to enter a 6-digit code to connect the app"
```

### CORRECT Understanding:
```
1. Connect app using Merchant ID + Secret Key (long string)
2. Process payments normally
3. 6-digit code appears automatically on receipt after each payment
```

---

## 🔧 Troubleshooting Connection Issues

### "Connection Failed" Error

**Check 1: Is backend running?**
- Open browser: `http://YOUR_IP:3000/`
- Should show: "POS 201.3 Backend Running"

**Check 2: Same WiFi?**
- Phone and laptop must be on same network

**Check 3: Correct IP?**
```powershell
ipconfig | findstr "IPv4"
```
- Use the IP that starts with `192.168.x.x`
- NOT `127.0.0.1` or `localhost`

**Check 4: Firewall?**
- Allow port 3000 in Windows Firewall

**Check 5: Secret Key correct?**
- Must copy exactly from Developer API Keys
- No extra spaces

---

## 📝 Summary Table

| What | When to Use | Format | Example |
|------|-------------|--------|---------|
| **Merchant ID** | App setup | Text | `MERCHANT123` |
| **Secret Key** | App setup | Long string | `sk_live_abc123xyz` |
| **Server URL** | App setup | URL | `http://192.168.1.100:3000/` |
| **6-Digit STAN** | After payment | 6 digits | `000042` |
| **6-Digit Settlement** | After sync | 6 digits | `456789` |

---

## ✅ Quick Checklist

```
□ 1. Backend running (npm run dev)
□ 2. Got API Key from Developer page
□ 3. Installed POS-2013-Fixed-v4.apk
□ 4. Entered 4 fields in Setup Screen
□ 5. NO 6-digit code entered anywhere
□ 6. Tapped "Register Device"
□ 7. Saw "Registration successful"
□ 8. Now processing payments!
```

---

## 🎯 The 6-Digit Code Flow (Visual)

```
┌─────────────────────────────────────────────────────────────┐
│                    APP SETUP (No 6-digit code!)              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Merchant ID: [MERCHANT123        ]                         │
│  Terminal ID: [TERM-A1B2C3D4      ]  ← Auto-generated       │
│  Server URL:  [http://192.168.1.100:3000/ ]                 │
│  Secret Key:  [sk_live_abc123...  ]  ← From Dashboard       │
│                                                              │
│  [🔗 REGISTER DEVICE]                                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                              ↓
                              ↓ AFTER successful registration
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              PROCESS PAYMENT (Now 6-digit appears!)          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Card: 4111 1111 1111 1111                                  │
│  Amount: $100.00                                            │
│                                                              │
│  [💰 PROCESS PAYMENT]                                       │
│                                                              │
│  Result:                                                    │
│  ✅ Transaction Stored                                       │
│  STAN: 000042           ← First 6-digit code!               │
│  Settlement: 456789     ← Second 6-digit code!              │
│  Status: SYNCED                                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

**Remember: Setup needs Secret Key (long string). 6-digit codes appear on receipts AFTER payments!**
