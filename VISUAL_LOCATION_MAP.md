# 🗺️ Visual Location Map - Where to Find Everything

## 📍 Main Wallets Page Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  ╔═══════════════════════════════════════════════════════════════╗  │
│  ║  🔹 OFFLINE POS 201.3                                         ║  │
│  ║                                                                ║  │
│  ║  Customer & Merchant Wallets                                   ║  │
│  ║  Manage customer balances, merchant settlement funds...        ║  │
│  ║                                                                ║  │
│  ║  ┌───────────────────┐  ┌──────────────────────────┐          ║  │
│  ║  │ Merchant Buy      │  │ → Send to Customer       │          ║  │
│  ║  │ Crypto            │  │                          │          ║  │
│  ║  └───────────────────┘  └──────────────────────────┘          ║  │
│  ║                                                                ║  │
│  ║  ┌───────────────────┐  ┌──────────────────────────┐          ║  │
│  ║  │ 🔥 Hot Wallet     │  │ Virtual Account          │          ║  │
│  ║  │ Payout   ◄─────── │  │                          │  ◄────── ║  │
│  ║  └───────────────────┘  └──────────────────────────┘     │    ║  │
│  ╚═══════════════════════════════════════════════════════════│════╝  │
│                                                                │       │
│  [👤 Wallet]  [🏦 Bank]  [🪙 Crypto] ◄─── Tabs here           │       │
│                                                                │       │
│  ┌─────────────────────────────────────────────────────────┐  │       │
│  │  👤 Customer Selection                                  │  │       │
│  │  ┌────────────────────────────────────────────────────┐ │  │       │
│  │  │ Search customers...                                │ │  │       │
│  │  └────────────────────────────────────────────────────┘ │  │       │
│  │                                                         │  │       │
│  │  [Alice Johnson] [Bob Smith] [Charlie Brown] ...       │  │       │
│  │                                                         │  │       │
│  └─────────────────────────────────────────────────────────┘  │       │
│                                                                │       │
│  ┌─────────────────────────────────────────────────────────┐  │       │
│  │  💰 Selected Customer Balance                           │  │       │
│  │  ┌────────────────────────────────────────────────────┐ │  │       │
│  │  │  Current Balance: $234.56                         │ │  │       │
│  │  │  [Top Up] [Debit] [Transfer]                      │ │  │       │
│  │  └────────────────────────────────────────────────────┘ │  │       │
│  └─────────────────────────────────────────────────────────┘  │       │
│                                                                │       │
│  ⬇️ Scroll Down                                               │       │
│                                                                │       │
│  ╔═══════════════════════════════════════════════════════════╗│       │
│  ║  💼 Merchant Section                                      ║│       │
│  ║  ─────────────────────────────────────────────────────────║│       │
│  ║                                                            ║│       │
│  ║  Settlement balance                                        ║│       │
│  ║  Live available balance                                    ║│       │
│  ║  USD 15,234.56  ◄───── Merchant Crypto Balance           ║│       │
│  ║  12 recent ledger records loaded                          ║│       │
│  ║                                                            ║│       │
│  ║  ┌───────────────────┐  ┌──────────────────────────┐      ║│       │
│  ║  │ Merchant Buy      │  │ → Send to Customer       │      ║│       │
│  ║  │ Crypto            │  │                          │      ║│       │
│  ║  └───────────────────┘  └──────────────────────────┘      ║│       │
│  ║                                                            ║│       │
│  ║  ┌───────────────────┐  ┌──────────────────────────┐      ║│       │
│  ║  │ 🔥 Hot Wallet     │  │ Virtual Account          │      ║│       │
│  ║  │ Payout  ◄─────────┼──┘                          │      ║│───────┘
│  ║  └───────────────────┘  └──────────────────────────┘      ║│
│  ║       ▲                                                    ║│
│  ║       └─ CLICK THIS BUTTON!                              ║│
│  ╚═══════════════════════════════════════════════════════════╝│
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## 📍 Hot Wallet Payout Modal

```
┌────────────────────────────────────────────────────────────────┐
│  ╔══════════════════════════════════════════════════════════╗  │
│  ║  Hot Wallet Delivery                              [X]    ║  │
│  ╚══════════════════════════════════════════════════════════╝  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ ⚠️ This sends a real on-chain payout through the        │  │
│  │ merchant hot-wallet rail. No simulation allowed.         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Merchant: MRC-1001                                            │
│                                                                 │
│  ╔══════════════════════════════════════════════════════════╗  │
│  ║  📋 Authorized Merchant Information                      ║  │
│  ╠══════════════════════════════════════════════════════════╣  │
│  ║  Authorized Person Name                                  ║  │
│  ║  ┌────────────────────────────────────────────────────┐ ║  │
│  ║  │ Jukruti Jacob Dumba  ✅ AUTO-FILLED!             │ ║  │
│  ║  └────────────────────────────────────────────────────┘ ║  │
│  ║                                                          ║  │
│  ║  Authorization Role/Title                                ║  │
│  ║  ┌────────────────────────────────────────────────────┐ ║  │
│  ║  │ Account Signatory  ✅ AUTO-FILLED!                │ ║  │
│  ║  └────────────────────────────────────────────────────┘ ║  │
│  ║                                                          ║  │
│  ║  Contact Email                                           ║  │
│  ║  ┌────────────────────────────────────────────────────┐ ║  │
│  ║  │ Jukrutidumba@gmail.com  ✅ AUTO-FILLED!           │ ║  │
│  ║  └────────────────────────────────────────────────────┘ ║  │
│  ║                                                          ║  │
│  ║  Contact Phone                                           ║  │
│  ║  ┌────────────────────────────────────────────────────┐ ║  │
│  ║  │ 0607289532  ✅ AUTO-FILLED!                        │ ║  │
│  ║  └────────────────────────────────────────────────────┘ ║  │
│  ╚══════════════════════════════════════════════════════════╝  │
│                                                                 │
│  ╔══════════════════════════════════════════════════════════╗  │
│  ║  🏢 Business Information                                 ║  │
│  ╠══════════════════════════════════════════════════════════╣  │
│  ║  Business Legal Name                                     ║  │
│  ║  ┌────────────────────────────────────────────────────┐ ║  │
│  ║  │ Jukruti Logistics (Pty) Ltd  ✅ AUTO-FILLED!      │ ║  │
│  ║  └────────────────────────────────────────────────────┘ ║  │
│  ║                                                          ║  │
│  ║  Business Registration Number                            ║  │
│  ║  ┌────────────────────────────────────────────────────┐ ║  │
│  ║  │ 2014/215965/07  ✅ AUTO-FILLED!                    │ ║  │
│  ║  └────────────────────────────────────────────────────┘ ║  │
│  ║                                                          ║  │
│  ║  Business Address                                        ║  │
│  ║  ┌────────────────────────────────────────────────────┐ ║  │
│  ║  │ 9 Houtkapper Str, Olifantshoek, Northern Cape,     │ ║  │
│  ║  │ 8450, South Africa  ✅ AUTO-FILLED!                │ ║  │
│  ║  └────────────────────────────────────────────────────┘ ║  │
│  ║                                                          ║  │
│  ║  Business Phone       Tax ID / VAT Number               ║  │
│  ║  ┌──────────────────┐ ┌──────────────────────────────┐ ║  │
│  ║  │ 0607289532  ✅   │ │ 9205076330089  ✅            │ ║  │
│  ║  └──────────────────┘ └──────────────────────────────┘ ║  │
│  ╚══════════════════════════════════════════════════════════╝  │
│                                                                 │
│  Asset                                                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ [USDT ▼] ◄─── Select crypto to send                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Network                                                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ tron ◄─── Enter network                                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Destination address                                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ T123...abc ◄─── Paste wallet address                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  USD amount                                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 100 ◄─── Enter amount                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Payout Reason / Notes                                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Monthly supplier payment ◄─── Enter reason               │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ ☑️ 💾 Save business information for future payouts       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ⬇️ SCROLL DOWN TO FIND SEND BUTTON ⬇️                        │
│                                                                 │
│  ┌─────────────┐  ┌──────────────────────────────────────┐    │
│  │   Cancel    │  │  Send from Hot Wallet  ◄── CLICK!    │    │
│  └─────────────┘  └──────────────────────────────────────┘    │
│                          ▲                                      │
│                          │                                      │
│                          └─ THIS IS THE SEND BUTTON!           │
└─────────────────────────────────────────────────────────────────┘
```

## 📍 Sidebar Navigation

```
┌───────────────────────┐
│  📱 POS System        │
│  ─────────────────── │
│                       │
│  🏠 Dashboard         │
│  💰 Sales             │
│  📦 Products          │
│  👥 Customers         │
│                       │
│  🔷 WALLETS  ◄────────┼── Click here for Wallets page
│                       │
│  👛 Customer Wallets  │
│                       │
│  🔥 Hot Wallet ◄──────┼── Click here for Hot Wallet page
│                       │
│  ⚙️ Settings          │
│  📊 Reports           │
│                       │
└───────────────────────┘
```

## 📍 Hot Wallet Management Page

```
┌──────────────────────────────────────────────────────────────────────┐
│  🔥 Hot Wallet Management                                            │
│  ──────────────────────────────────────────────────────────────────  │
│                                                                       │
│  [📊 Overview]  [🔄 Transfer]  [💸 Withdraw]  [📜 History]  [⚙️ Settings]
│       ▲                                                               │
│       └─── Click tabs to switch views                                │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  📊 OVERVIEW TAB (Default)                                      │ │
│  │  ─────────────────────────────────────────────────────────────  │ │
│  │                                                                 │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │ │
│  │  │ ₮ USDT       │  │ ⬡ TRX        │  │ 🟡 BNB       │         │ │
│  │  │ Balance      │  │ Balance      │  │ Balance      │         │ │
│  │  │ 15,000.50    │  │ 1,250.75     │  │ 5.25         │         │ │
│  │  │ USDT         │  │ TRX          │  │ BNB          │         │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘         │ │
│  │                                                                 │ │
│  │  ┌──────────────┐                                              │ │
│  │  │ 🟣 MATIC     │                                              │ │
│  │  │ Balance      │                                              │ │
│  │  │ 850.00       │                                              │ │
│  │  │ MATIC        │                                              │ │
│  │  └──────────────┘                                              │ │
│  │                                                                 │ │
│  │  ╔═════════════════════════════════════════════════════════╗  │ │
│  │  ║  Hot Wallet Status                                      ║  │ │
│  │  ╠═════════════════════════════════════════════════════════╣  │ │
│  │  ║  Status: 🟢 Online                                      ║  │ │
│  │  ║  Network: Tron / BSC                                    ║  │ │
│  │  ║  Last Activity: 2 mins ago                              ║  │ │
│  │  ║  Total Txns Today: 12                                   ║  │ │
│  │  ╚═════════════════════════════════════════════════════════╝  │ │
│  │                                                                 │ │
│  │  Recent Transactions                                            │ │
│  │  ┌─────────────────────────────────────────────────────────┐  │ │
│  │  │  ↓ Deposit    150.00 USDT    T123...abc    2m ago  🟢  │  │ │
│  │  │  ↑ Withdraw    50.00 USDT    T456...def    5m ago  🟢  │  │ │
│  │  │  ⇄ Transfer    25.00 USDT    Merchant    10m ago  🟢   │  │ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  │                                                                 │ │
│  │  ┌──────────────┐  ┌──────────────┐                           │ │
│  │  │  🔄 Transfer │  │ 💸 Withdraw  │                           │ │
│  │  └──────────────┘  └──────────────┘                           │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

## 🎯 Quick Navigation Map

### To Make a Hot Wallet Payout:
```
Start
  ↓
Click "Wallets" in Sidebar
  ↓
Look at TOP of page (dark header)
  ↓
Click "🔥 Hot Wallet Payout" (orange button)
  ↓
Modal opens with form
  ↓
Verify your info is auto-filled ✅
  ↓
Enter: Asset, Network, Address, Amount, Reason
  ↓
SCROLL DOWN in modal
  ↓
Click "Send from Hot Wallet" (orange button at bottom)
  ↓
Wait for confirmation
  ↓
Done! ✅
```

### To Check Transaction Status:
```
Option 1: Hot Wallet Page
  ↓
Click "🔥 Hot Wallet" in Sidebar
  ↓
Click "📜 History" tab
  ↓
See all transactions with status

Option 2: Wallets Page
  ↓
Click "Wallets" in Sidebar
  ↓
Click "Crypto" tab
  ↓
Scroll to "Transaction History"
  ↓
Find your transaction
```

### To See Merchant Balance:
```
Click "Wallets" in Sidebar
  ↓
Scroll down to green card section
  ↓
See "Settlement balance"
  ↓
See "USD XXX.XX"
  ↓
This is your merchant balance!
```

## 🚨 Troubleshooting Map

### "Can't find the Send button":
```
Problem: Send button not visible
  ↓
Solution: SCROLL DOWN in the modal
  ↓
Button is at the BOTTOM
  ↓
Look for orange button labeled "Send from Hot Wallet"
```

### "403 Error on Virtual Account":
```
Problem: Request failed with 403
  ↓
Check: Backend .env file
  ↓
Verify: TRANSAK_API_KEY is set
  ↓
Verify: TRANSAK_API_SECRET is set
  ↓
Verify: Email is verified with OTP
  ↓
Check: Backend logs for detailed error
```

### "Transfer initiated - what next?":
```
"Transfer of 15 USDT initiated"
  ↓
This means: Transfer was submitted ✅
  ↓
Check status:
  Option 1: Hot Wallet → History tab
  Option 2: Wallets → Crypto tab → Transactions
  ↓
Look for transaction status:
  🟢 Completed = Success!
  🟡 Pending = Still processing
  🔴 Failed = Error
```

## 📱 Mobile/Small Screen Layout

On smaller screens, buttons stack vertically:

```
┌─────────────────────────┐
│  Customer & Merchant    │
│  Wallets                │
│  ─────────────────────  │
│                         │
│  ┌───────────────────┐  │
│  │ Merchant Buy      │  │
│  │ Crypto            │  │
│  └───────────────────┘  │
│                         │
│  ┌───────────────────┐  │
│  │ → Send to         │  │
│  │ Customer          │  │
│  └───────────────────┘  │
│                         │
│  ┌───────────────────┐  │
│  │ 🔥 Hot Wallet     │  │
│  │ Payout            │  │
│  └───────────────────┘  │
│         ▲               │
│         └─ Click here!  │
│                         │
│  ┌───────────────────┐  │
│  │ Virtual Account   │  │
│  └───────────────────┘  │
│                         │
└─────────────────────────┘
```

---

**Remember**: 
- 🔥 **Hot Wallet Payout** button is at the **TOP** of Wallets page
- **Send button** is at the **BOTTOM** of the modal (scroll down!)
- Your **business info** auto-fills automatically ✅
- **Merchant balance** is in the green card in the middle of Wallets page

**Everything is ready to use!** 🚀
