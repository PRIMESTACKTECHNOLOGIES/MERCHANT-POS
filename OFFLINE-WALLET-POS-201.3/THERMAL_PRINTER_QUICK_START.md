# 🖨️ THERMAL PRINTER - QUICK START GUIDE

## 📦 WHAT YOU GOT

I've created **thermal receipt printing** for your POS app with these files:

### New Files Created:
1. ✅ `ThermalReceiptGenerator.kt` - Main printing code
2. ✅ `THERMAL_RECEIPT_DESIGN.md` - Receipt layout examples
3. ✅ `OFFLINE_CARD_TAP_EXPLANATION.md` - How offline payments work

---

## 🛒 REQUIRED HARDWARE

### Buy a Thermal Printer (Recommended):

| Model | Price | Connection | Paper | Best For |
|-------|-------|------------|-------|----------|
| **Xprinter XP-58IIH** | ~$50 | Bluetooth+USB | 58mm | Budget-friendly |
| **GOOJPRT MTP-3** | ~$80 | Bluetooth+USB | 80mm | Mobile use |
| **Zjiang ZJ-58** | ~$40 | USB/Bluetooth | 58mm | Basic use |
| **EPSON TM-T20II** | ~$200 | USB/Ethernet | 80mm | Professional |

**Where to Buy:**
- Amazon
- AliExpress (cheaper but slower shipping)
- Local POS equipment supplier

### Also Buy:
- **Thermal Paper Rolls** (58mm or 80mm depending on printer)
- ~$5-10 for 10 rolls

---

## 🔌 PRINTER SETUP

### Step 1: Pair Printer with Phone
1. Turn on Bluetooth printer
2. Open phone Settings → Bluetooth
3. Find printer name (e.g., "Xprinter", "XP-58", "Printer")
4. Tap to pair (default password usually `0000` or `1234`)

### Step 2: Update AndroidManifest.xml
Add Bluetooth permission:
```xml
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
```

### Step 3: Use in Your Code

#### Option A: Print from MainActivity
```kotlin
import com.pos2013.offline.util.ThermalReceiptGenerator

// In your MainActivity.kt after successful payment:
fun onPaymentSuccess(transaction: TransactionEntity) {
    // Print receipt
    val receiptData = ThermalReceiptGenerator.generate58mmReceipt(
        transaction = transaction,
        isOffline = !isOnline  // true if offline transaction
    )
    
    ThermalReceiptGenerator.printViaBluetooth(
        context = this,
        printerName = "Printer",  // or "XP-58", "POS", etc.
        receiptData = receiptData
    )
}
```

#### Option B: Print from ReceiptActivity
```kotlin
// In ReceiptActivity.kt
btnPrint.setOnClickListener {
    transaction.printThermalReceipt(
        context = this,
        isOffline = intent.getBooleanExtra("isOffline", false)
    )
}
```

---

## 🧾 RECEIPT EXAMPLES

### 58mm Receipt (Small Printer):
```
--------------------------------
     AM GLOBAL PAYMENT
      Dubai, UAE
    +971 52 837 3634
--------------------------------
        SALE RECEIPT
--------------------------------
DATE: 22/03/26
TIME: 14:35:22
STAN: 000847
TERM: TERM-001
--------------------------------
CARD: VISA ****1111
ENTRY: CONTACTLESS
--------------------------------
TOTAL:
        AED 150.00

        ✓ APPROVED
--------------------------------
Thank you!
Powered by POS 201.3
--------------------------------
```

### Offline Receipt (Shows Warning):
```
        ✓ APPROVED

⚠ OFFLINE TRANSACTION
Will sync when online

SETTLEMENT: PENDING
```

---

## 💳 OFFLINE CARD TAP - YOUR QUESTION ANSWERED

### Q: Can customers tap physical cards when offline?

### A: YES! Here's how:

```
┌────────────────────────────────────────┐
│  CUSTOMER TAPS CARD                   │
│  ├─ Phone reads NFC/EMV data          │
│  ├─ Card number encrypted immediately │
│  ├─ Stored in phone's secure database │
│  └─ Receipt prints "OFFLINE"          │
│                                        │
│  WHEN BACK ONLINE:                     │
│  └─ Tap "🔄 Sync" to upload           │
│  └─ Server processes all payments     │
│  └─ Settlement codes received         │
└────────────────────────────────────────┘
```

### Security:
- ✅ Card data **encrypted** with AES-256
- ✅ Only last 4 digits shown on receipt
- ✅ Full card number **never** stored plain text
- ✅ CVV **never** stored

### Receipt Shows:
```
⚠ OFFLINE TRANSACTION
Will sync when online
Settlement pending
```

---

## ⚠️ IMPORTANT NOTES

### Offline Limits (Recommended):
```kotlin
// Maximum offline transactions before forcing sync
const val MAX_OFFLINE_TRANSACTIONS = 10

// Maximum total offline amount (AED 5,000)
const val MAX_OFFLINE_AMOUNT = 500000

// Maximum single transaction (AED 1,000)
const val MAX_SINGLE_OFFLINE = 100000
```

### Risks:
- Card might be DECLINED when synced
- Sync must happen within 24 hours
- Customer might spend more than their limit

---

## 🔧 TROUBLESHOOTING

### "Printer not found"
- Make sure printer is paired in Bluetooth settings
- Try different printer name: "XP-58", "POS", "Printer"
- Check printer is turned on

### "Print failed"
- Check Bluetooth is enabled on phone
- Printer might be out of paper
- Try re-pairing the printer

### Receipt looks wrong
- Check paper width setting (58mm vs 80mm)
- Make sure using correct generate function
- Some printers need different command codes

---

## 📱 TEST PRINT

Add this test button temporarily:
```kotlin
// In MainActivity onCreate
btnTestPrint.setOnClickListener {
    val testReceipt = """
        TEST PRINT
        ----------
        Printer: OK
        Time: ${SimpleDateFormat("HH:mm:ss").format(Date())}
        ----------
        
        
        ${ESC}V${0x00.toChar()}
    """.trimIndent()
    
    ThermalReceiptGenerator.printViaBluetooth(
        context = this,
        receiptData = testReceipt.toByteArray()
    )
}
```

---

## ✅ CHECKLIST

- [ ] Buy thermal printer (58mm recommended)
- [ ] Buy thermal paper rolls
- [ ] Pair printer with phone via Bluetooth
- [ ] Add Bluetooth permissions to AndroidManifest.xml
- [ ] Add ThermalReceiptGenerator.kt to project
- [ ] Add print button to ReceiptActivity
- [ ] Test print a receipt
- [ ] Configure offline transaction limits

---

## 🎯 NEXT STEPS

1. **Buy a printer** (Xprinter XP-58IIH recommended - ~$50)
2. **Add the code** to your Android project
3. **Test printing** before going live
4. **Train staff** on paper replacement

**Need help?** Check the detailed guides:
- `THERMAL_RECEIPT_DESIGN.md` - Full receipt layouts
- `OFFLINE_CARD_TAP_EXPLANATION.md` - How offline works
