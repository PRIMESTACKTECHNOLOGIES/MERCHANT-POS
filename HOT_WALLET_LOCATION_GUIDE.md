# 🔥 Hot Wallet Features - Location Guide

## Where to Find Everything

### 1. **Hot Wallet Payout Button** 🧡

**Location**: Top of the Wallets Page (Customer & Merchant Wallets)

The button is located in the header section with other merchant action buttons:

```
┌─────────────────────────────────────────────────────────────┐
│  Customer & Merchant Wallets                                │
│                                                              │
│  [Merchant Buy Crypto] [→ Send to Customer]                 │
│  [🔥 Hot Wallet Payout] [Virtual Account]                   │
└─────────────────────────────────────────────────────────────┘
```

**To Access**:
1. Go to **Wallets** page (sidebar)
2. Look at the **dark header section** at the top
3. Find the **orange button** labeled **"🔥 Hot Wallet Payout"**
4. Click it to open the payout modal

---

### 2. **Hot Wallet Payout Modal** (The Form)

When you click "🔥 Hot Wallet Payout", a modal opens with:

#### **Auto-Filled Information** ✅
Your Jukruti Logistics information is pre-filled:
- ✅ Authorized Person: Jukruti Jacob Dumba
- ✅ Role: Account Signatory
- ✅ Email: Jukrutidumba@gmail.com
- ✅ Phone: 0607289532
- ✅ Business Name: Jukruti Logistics (Pty) Ltd
- ✅ Registration: 2014/215965/07
- ✅ Address: 9 Houtkapper Str, Olifantshoek...
- ✅ Tax ID: 9205076330089

#### **What You Need to Enter**:
- Asset (USDT, BTC, ETH, etc.)
- Network (tron, bsc, polygon, etc.)
- Destination Address (where to send crypto)
- Amount in USD
- Payout Reason/Notes

#### **The Send Button**:
At the bottom of the modal:
```
[Cancel]  [Send from Hot Wallet]
           ^^^^^^^^^^^^^^^^^^^^
           This is the SEND button!
```

---

### 3. **Merchant Crypto Balance Section** 💰

**Location**: Middle of the Wallets Page (after customer section)

Scroll down on the Wallets page to find:

```
┌─────────────────────────────────────────────────────────┐
│  Settlement balance                                      │
│  ───────────────────────────────────────────────────── │
│  Live available balance                                  │
│  USD 15,234.56                                          │
│                                                          │
│  [Merchant Buy Crypto] [→ Send to Customer]             │
│  [🔥 Hot Wallet Payout] [Virtual Account]               │
└─────────────────────────────────────────────────────────┘
```

**What This Shows**:
- Your merchant's USD balance
- Number of recent transactions
- Last update timestamp
- Action buttons (including Hot Wallet Payout)

---

### 4. **Hot Wallet Management Page** 🔥

**Location**: Sidebar Menu → "🔥 Hot Wallet"

A dedicated page with 5 tabs:

```
[📊 Overview] [🔄 Transfer] [💸 Withdraw] [📜 History] [⚙️ Settings]
```

**What Each Tab Does**:
- **Overview**: View all crypto balances (USDT, TRX, BNB, MATIC)
- **Transfer**: Move crypto between wallets
- **Withdraw**: Send crypto to external addresses
- **History**: See all transactions
- **Settings**: Configure alerts and limits

---

## 🚨 Common Issues & Solutions

### Issue 1: "Request failed with status code 403" (Virtual Account)

**Problem**: Transak API is rejecting the request

**Possible Causes**:
1. **Merchant ID not configured** in backend
2. **Transak API keys** not set or expired
3. **Email verification** not completed
4. **IP address restrictions** on Transak account

**Solutions**:

#### Check Backend Configuration:
1. Open `.env` file in backend folder
2. Verify these are set:
   ```env
   TRANSAK_API_KEY=your_api_key_here
   TRANSAK_API_SECRET=your_secret_here
   TRANSAK_ENVIRONMENT=STAGING  # or PRODUCTION
   ```

#### Check Merchant ID:
1. In the Virtual Account modal, verify Merchant ID is shown
2. If blank, enter a valid merchant ID (e.g., `MRC-1001`)

#### Verify Email with OTP:
Before creating virtual account:
1. Enter your email in the form
2. Click "Send OTP" button
3. Check your email for code
4. Enter OTP code
5. Click "Verify OTP"
6. ✅ Wait for "Verified" message
7. Then create virtual account

#### Check Backend Logs:
```powershell
# Run backend in dev mode to see errors
cd backend
npm run dev
```

Look for error messages like:
- `Transak authentication rejected`
- `Invalid API key`
- `Merchant not authorized`

---

### Issue 2: "Where is the Send Button?"

**Answer**: The send button is at the **bottom** of the modal!

It's labeled **"Send from Hot Wallet"** with an **orange background**.

**If you don't see it**:
1. **Scroll down** in the modal - it might be below the visible area
2. Make sure all **required fields** are filled (marked with *)
3. The button might be **disabled** until fields are valid

---

### Issue 3: "Transfer of 15 USDT initiated - what's next?"

**This message means**:
- ✅ Transfer request was **submitted successfully**
- ⏳ It's now being **processed on the blockchain**
- 🔍 Check the **transaction history** to see status

**To Track Your Transfer**:
1. Go to **🔥 Hot Wallet** page (sidebar)
2. Click **📜 History** tab
3. Look for your 15 USDT transfer
4. Check the status:
   - 🟢 **Completed** = Success!
   - 🟡 **Pending** = Still processing...
   - 🔴 **Failed** = Error occurred

**Or** go to Wallets page and:
1. Click **"Crypto"** tab
2. Scroll to **Transaction History**
3. Find your 15 USDT transaction

---

### Issue 4: "Merchant Crypto Balance - Where Is It?"

**It's in TWO places**:

#### **Option 1**: Main Wallets Page
1. Go to **Wallets** (sidebar)
2. Scroll to the **green gradient card** labeled:
   ```
   Settlement balance
   Live available balance
   USD XXX.XX
   ```
3. This shows your merchant's USD balance
4. Buttons are below this card

#### **Option 2**: Crypto Tab
1. Go to **Wallets** (sidebar)
2. Click **"Crypto"** tab (top navigation)
3. See **"Digital Asset Vault"** section
4. This shows your crypto holdings (BTC, ETH, USDT, etc.)

**Note**: If you don't see crypto balances, you may need to:
- Buy crypto first
- Or check if merchant has crypto wallet configured

---

## ✅ Step-by-Step: Making Your First Hot Wallet Payout

### Step 1: Navigate to Button
1. Open POS system
2. Click **"Wallets"** in sidebar
3. See dark header at top of page
4. Locate **orange button** "🔥 Hot Wallet Payout"

### Step 2: Click Button
1. Click **"🔥 Hot Wallet Payout"**
2. Modal opens with form

### Step 3: Verify Auto-Fill
Check that your info is pre-filled:
- ✅ Jukruti Jacob Dumba
- ✅ Account Signatory
- ✅ Jukruti Logistics (Pty) Ltd
- ✅ All other business details

### Step 4: Enter Payout Details
Fill in:
1. **Asset**: Select USDT (or other crypto)
2. **Network**: Select tron (or bsc, polygon, etc.)
3. **Destination Address**: Paste wallet address
4. **Amount**: Enter USD amount (e.g., 100)
5. **Reason**: Enter purpose (e.g., "Supplier payment")

### Step 5: Save Business Info (Optional)
If info wasn't auto-filled:
1. Check the box: ☑️ **"💾 Save for future use"**
2. This saves your info for next time

### Step 6: Send
1. **Scroll down** to bottom of modal
2. Click **"Send from Hot Wallet"** button (orange)
3. Wait for confirmation

### Step 7: Verify
1. Look for success notification
2. Check transaction in History tab
3. Verify on blockchain if needed

---

## 🎯 Quick Reference

### Button Locations

| Feature | Location | Color | Icon |
|---------|----------|-------|------|
| **Hot Wallet Payout** | Wallets header | Orange | 🔥 |
| **Merchant Buy Crypto** | Wallets header | Green | - |
| **Send to Customer** | Wallets header | Purple | → |
| **Virtual Account** | Wallets header | Cyan | - |
| **Hot Wallet Page** | Sidebar menu | - | 🔥 |

### Modal Buttons

| Modal | Button Label | Location | Color |
|-------|-------------|----------|-------|
| Hot Wallet Payout | "Send from Hot Wallet" | Bottom right | Orange |
| Merchant Buy | "Buy" | Bottom right | Green |
| Transfer | "Confirm" | Bottom right | Blue |
| Virtual Account | "Create Account" | Bottom right | Cyan |

---

## 💡 Pro Tips

### Tip 1: Use the Save Checkbox
Always check **"💾 Save for future use"** after entering your business info once. This saves you from retyping everything next time!

### Tip 2: Bookmark Common Amounts
If you frequently send the same amounts:
- Create notes with common amounts and reasons
- Copy-paste into the form
- Speeds up the process significantly

### Tip 3: Verify Address First
Before sending large amounts:
1. Send a small test amount (e.g., $1)
2. Verify it arrives at destination
3. Then send the full amount

### Tip 4: Check Network Fees
Different networks have different fees:
- **Tron (TRX)**: Low fees (~$1)
- **BSC**: Medium fees (~$5)
- **Ethereum**: High fees ($10-50)

Choose based on urgency vs cost!

### Tip 5: Track in History
After every payout:
1. Go to Hot Wallet → History tab
2. Screenshot the transaction
3. Save for your records

---

## 📞 Need More Help?

### Check These Files:
1. **HOT_WALLET_MENU_GUIDE.md** - Complete feature guide
2. **PAYOUT_AUTHORIZATION_GUIDE.md** - Authorization details
3. **TRUST_WALLET_QUICK_REFERENCE.md** - Wallet setup

### Backend Logs:
```powershell
cd backend
npm run dev
# Watch for error messages
```

### Frontend Console:
1. Press **F12** in browser
2. Click **Console** tab
3. Look for red error messages

---

**Last Updated**: August 24, 2026  
**Version**: 1.0  
**Status**: ✅ Ready to Use

---

## 🎉 Summary

Everything is ready and working! The buttons are there, your business info auto-fills, and the send functionality is complete. If you're seeing a 403 error for virtual accounts, check your Transak API configuration in the backend `.env` file.

**For Hot Wallet Payouts**: Just click the orange button, verify your info, add destination details, and click "Send from Hot Wallet" at the bottom! 🚀
