# 🎯 QUICK REFERENCE CARD
## POS Offline Software - Payment Flow

---

## ⚡ THE 4 STEPS (Memorize This!)

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ CUSTOMER │───→│ DATABASE │───→│  GATEWAY │───→│   BANK   │
│   PAYS   │    │  (YOURS) │    │          │    │          │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
    $100           Stored         Processed      Deposited
                   Pending        T+2 days       Net: $96.80
```

---

## 📱 ANDROID APP SETTINGS

| Field | Value | Where From |
|-------|-------|------------|
| **Server URL** | `http://192.168.1.160:3000/` | Your PC's IP |
| **Merchant ID** | `MRC-1001` | Default/Database |
| **Terminal ID** | `TERM001` | Auto-generated |
| **Secret Key** | `sk_test_default_key_123` | Dashboard → Developer |

---

## 🌐 IMPORTANT URLs

| Service | URL |
|---------|-----|
| **Dashboard Login** | http://localhost:5173/login |
| **Dashboard POS** | http://localhost:5173/pos |
| **Backend Health** | http://192.168.1.160:3000/ |

---

## 🔑 DEFAULT LOGIN

```
Username: admin
Password: admin123
```

---

## 💰 MONEY FLOW TIMELINE

| Time | Where | You Can Access? |
|------|-------|-----------------|
| T+0 (now) | Customer's card | ❌ No |
| T+0 | Android phone (offline) | ❌ No |
| T+0 | Your database | 👁️ View only |
| T+0 | Payment gateway | ⏳ Pending |
| T+2 days | Gateway account | ✅ Yes |
| T+2-3 days | Your bank | ✅✅✅ FULL ACCESS |

---

## 📊 FEE CALCULATOR

```
Customer Pays:    $100.00
Gateway Fee:    - $3.20  (2.9% + $0.30)
─────────────────────────
You Receive:      $96.80
```

---

## 🏷️ CODE DEFINITIONS

| Code | Meaning | Example |
|------|---------|---------|
| **STAN** | Transaction tracking | `000042` |
| **Settlement Code** | Batch reference | `SETT-789123` |
| **Gateway ID** | Provider reference | `bt_abc123` |

---

## 🔄 STATUS LIFECYCLE

```
PENDING → STORED_LOCALLY → PENDING_SYNC → UPLOADED → SETTLED → PAID_OUT
```

---

## 🆘 TROUBLESHOOTING

| Problem | Solution |
|---------|----------|
| App won't connect | Check IP is 192.168.1.160:3000 |
| "Invalid credentials" | Use API key from Dashboard → Developer |
| Transactions not syncing | Check WiFi, restart app |
| No money in bank | Wait T+2 days, check gateway account |

---

## 📁 IMPORTANT FILES

| File | Purpose |
|------|---------|
| `COMPLETE_PAYMENT_FLOW_DOCUMENTATION.md` | Full guide |
| `PAYMENT_FLOW_VISUAL_DIAGRAM.txt` | ASCII diagram |
| `database.sqlite` | Your transaction database |
| `pos_offline.sqlite` | POS data |

---

## 📞 KEY ENDPOINTS

```bash
# Upload batch (Android)
POST /merchant/v1/api/payment2013/batch

# Cashout to gateway (Dashboard)
POST /merchant/v1/cashout/braintree

# View transactions
GET /merchant/v1/transactions
```

---

## ✅ DAILY CHECKLIST

- [ ] Backend running (port 3000)
- [ ] Dashboard accessible
- [ ] Android app can connect
- [ ] Check pending transactions
- [ ] Sync offline transactions
- [ ] Cashout settled batches

---

**Print this card and keep it handy!** 🖨️

---

*Quick Reference Card - POS Offline Software*  
*Created: March 8, 2026*
