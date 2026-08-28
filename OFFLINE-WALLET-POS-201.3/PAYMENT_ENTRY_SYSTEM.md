# Professional POS Manual Entry System

## Overview

A **real-world terminal-grade** manual card entry screen for your 201.3 POS. This is what cashiers see when processing card payments manually.

## Features

### 🎯 Core Functionality
- ✅ **Amount Entry** - Currency formatted input with quick amount buttons ($10, $20, $50, $100)
- ✅ **Card Number Input** - Auto-formatted (4-4-4-4) with card type detection
- ✅ **Expiry Date** - Auto-formatted MM/YY with validation
- ✅ **CVV Input** - Secure password-style input (3 digits, 4 for AMEX)
- ✅ **Transaction Type** - Sale, Refund, Pre-Auth selection

### 🔒 Security Features
- ✅ **Luhn Algorithm** - Real-time card number validation
- ✅ **Expiry Validation** - Checks if card is expired
- ✅ **CVV Help** - Explains where to find CVV
- ✅ **PCI DSS Notice** - Compliance messaging
- ✅ **Large Amount Confirmation** - Extra confirmation for $1000+

### 💳 Card Type Detection
Automatically detects and shows card logos:
- Visa (4xxx)
- MasterCard (5xxx)
- American Express (34xx, 37xx)
- Discover (6xxx)

## UI Layout

```
┌─────────────────────────────────────┐
│ ← Manual Entry    Terminal: T2013-001│
├─────────────────────────────────────┤
│ Transaction Type                    │
│ [SALE●] [REFUND] [PRE-AUTH]         │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ AMOUNT                          │ │
│ │ $ [__________]                  │ │
│ │ [$10] [$20] [$50] [$100]       │ │
│ │ [Enter Exact Amount]            │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ CARD DETAILS                    │ │
│ │                                 │ │
│ │ Card Number                     │ │
│ │ [____ ____ ____ ____] [VISA]   │ │
│ │                                 │ │
│ │ Expiry    CVV        [?]       │ │
│ │ [MM/YY]   [___]                │ │
│ │                                 │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ 🔒 Card data encrypted. PCI DSS    │
├─────────────────────────────────────┤
│ [Cancel] [Clear] [PROCESS PAYMENT] │
└─────────────────────────────────────┘
```

## Real-Time Validation

| Field | Validation | Error Message |
|-------|------------|---------------|
| Amount | > 0 | "Enter valid amount" |
| Card Number | Luhn algorithm + length | "Invalid card number" |
| Expiry | MM/YY format + not expired | "Invalid expiry (MM/YY)" |
| CVV | 3 digits (4 for AMEX) | "Invalid CVV" |

## Card Type Auto-Detection

```
4xxx xxxx xxxx xxxx → VISA
5xxx xxxx xxxx xxxx → MasterCard
34xx xxxx xxxx xx   → AMEX (15 digits)
37xx xxxx xxxx xx   → AMEX (15 digits)
6xxx xxxx xxxx xxxx → Discover
```

## Usage Flow

```
┌─────────────┐
│   Launch    │
│PaymentEntry │
└──────┬──────┘
       ▼
┌─────────────┐
│ Select Type │
│  (Sale/etc) │
└──────┬──────┘
       ▼
┌─────────────┐     ┌─────────────┐
│   Enter     │────►│ Quick Btn?  │
│   Amount    │     │ Auto-fill   │
└──────┬──────┘     └─────────────┘
       ▼
┌─────────────┐     ┌─────────────┐
│  Enter Card │────►│ Auto-detect │
│   Number    │     │  Card Type  │
└──────┬──────┘     └─────────────┘
       ▼
┌─────────────┐
│  Enter Exp  │
│   & CVV     │
└──────┬──────┘
       ▼
┌─────────────┐     ┌─────────────┐
│ All Valid?  │─No──►│ Show Errors │
└──────┬──────┘     └─────────────┘
      Yes
       ▼
┌─────────────┐     ┌─────────────┐
│ Amount >=   │─Yes──►│ Confirm     │
│  $1000?     │     │ Dialog      │
└──────┬──────┘     └─────────────┘
      No
       ▼
┌─────────────┐
│   Process   │
│   Payment   │
└──────┬──────┘
       ▼
┌─────────────┐
│  Navigate   │
│  to Receipt │
└─────────────┘
```

## Code Example

### Launch from MainActivity
```kotlin
// Simple launch
binding.btnProcessPayment.setOnClickListener {
    startActivity(Intent(this, PaymentEntryActivity::class.java))
}

// With pre-filled amount (optional)
val intent = Intent(this, PaymentEntryActivity::class.java).apply {
    putExtra("preset_amount", 50.00)
}
startActivity(intent)
```

### Handle Result
```kotlin
// In PaymentEntryActivity
private fun navigateToReceipt(txnId: String, stan: String, isOnline: Boolean) {
    val intent = Intent(this, ReceiptActivity::class.java).apply {
        putExtra(ReceiptActivity.EXTRA_LOCAL_TXN_ID, txnId)
        putExtra(ReceiptActivity.EXTRA_AMOUNT, currentAmount)
        putExtra(ReceiptActivity.EXTRA_STAN, stan)
        putExtra(ReceiptActivity.EXTRA_IS_OFFLINE, !isOnline)
    }
    startActivity(intent)
    finish() // Close payment entry
}
```

## File Structure

```
com.pos2013.offline/
├── ui/
│   └── PaymentEntryActivity.kt       # Main entry screen
│
├── res/layout/
│   └── activity_payment_entry.xml    # Professional UI layout
│
└── res/drawable/
    ├── ic_card_visa.xml              # Visa logo
    ├── ic_card_mastercard.xml        # MasterCard logo
    ├── ic_card_amex.xml              # AMEX logo
    ├── ic_card_discover.xml          # Discover logo
    ├── ic_card_generic.xml           # Generic card
    ├── ic_help.xml                   # Help icon
    ├── ic_security.xml               # Security icon
    └── ic_payment.xml                # Payment button icon
```

## Validation Examples

### Valid Card Numbers (Test)
```
Visa:       4111 1111 1111 1111
MasterCard: 5555 5555 5555 4444
Amex:       3782 822463 10005
Discover:   6011 1111 1111 1117
```

### Invalid (Fails Luhn)
```
4111 1111 1111 1112  (last digit wrong)
1234 5678 9012 3456  (random numbers)
```

## Complete Payment Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    PAYMENT FLOW                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Main      │───►│   Payment   │───►│   Process   │     │
│  │  Activity   │    │   Entry     │    │  Payment    │     │
│  │             │    │  (NEW!)     │    │  (UseCase)  │     │
│  │ [Process    │    │             │    │             │     │
│  │  Payment]   │    │ • Amount    │    │ • Validate  │     │
│  │             │    │ • Card #    │    │ • Encrypt   │     │
│  └─────────────┘    │ • Exp/CVV   │    │ • Store     │     │
│                     │ • Type      │    │ • Sync      │     │
│                     └─────────────┘    └──────┬──────┘     │
│                                                │            │
│                     ┌──────────────────────────┘            │
│                     ▼                                       │
│              ┌─────────────┐    ┌─────────────┐            │
│              │   Receipt   │◄───│   Result    │            │
│              │   Screen    │    │             │            │
│              │             │    │ Success/    │            │
│              │ • Amount    │    │ Pending/    │            │
│              │ • STAN      │    │ Error       │            │
│              │ • Txn ID    │    │             │            │
│              │ • Status    │    │             │            │
│              └─────────────┘    └─────────────┘            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Benefits

1. **Professional Look** - Like Ingenico/Verifone terminals
2. **Error Prevention** - Real-time validation
3. **User Friendly** - Auto-formatting, quick buttons
4. **Secure** - Luhn check, expiry validation
5. **Flexible** - Multiple transaction types

## Next Steps

Your POS now has a **professional manual entry screen**! Next options:

1. **Keypad Entry Mode** - Numeric keypad for amount (like ATM)
2. **Signature Capture** - Digital signature on screen
3. **Tip Entry** - Add tips before processing
4. **Split Payment** - Multiple cards for one bill

**Your POS now looks and works like a real payment terminal! 🎉**
