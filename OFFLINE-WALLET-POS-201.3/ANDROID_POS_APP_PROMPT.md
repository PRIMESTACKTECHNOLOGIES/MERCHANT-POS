# Android POS Terminal App Development Prompt (Protocol 201.3)

## Project Overview
Build a native Android POS (Point of Sale) application that operates primarily offline using the "201.3 Offline Protocol". The app must securely store transactions locally and sync them to a backend server when internet connectivity is available.

## Core Requirements
- **Platform:** Android (Kotlin / Jetpack Compose)
- **Architecture:** MVVM with Clean Architecture
- **Offline-First:** All transactions are stored locally in an encrypted database (Room + SQLCipher) before syncing.
- **Protocol Version:** 201.3

## Key Features

### 1. Terminal Configuration (Settings Screen)
- **Merchant ID:** Input field (e.g., "MRC-1001")
- **Terminal ID:** Input field (e.g., "T-8800-001")
- **Shared Secret:** Input field (Password masked) for HMAC signature generation.
- **Backend URL:** Input field (e.g., "https://your-backend-api.com")
- **Mode:** Toggle between "Test" and "Live".
- **Device ID:** Display the unique Android ID (e.g., `8AF3D2...`) prominently for registration.

### 2. Transaction Flow (Main Screen)
- **Keypad UI:** Large numeric keypad for entering amount (e.g., $0.00).
- **Card Entry:** 
  - Support manual entry (PAN, Expiry, CVV).
  - *Optional:* Support NFC/EMV reading if hardware available.
- **Processing:**
  - Generate a unique **6-Digit STAN** (System Trace Audit Number).
    - Logic: Auto-incrementing integer (000001 to 999999), persisting across app restarts.
  - Generate **Batch ID** (UUID).
  - Store transaction securely in local database with status `PENDING`.
- **Receipt:** Display success screen with "Approval Code" (locally generated mock code if offline, or real code if online).

### 3. Offline Protocol 201.3 Implementation
The app must adhere to the following data structure for storing and syncing transactions.

**Transaction Data Structure:**
```json
{
  "protocolVersion": "201.3",
  "merchantId": "MRC-1001",
  "terminalId": "T-8800-001",
  "batchId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2023-10-27T10:00:00Z",
  "transactions": [
    {
      "amountMinor": 1000, // $10.00
      "currency": "USD",
      "pan": "4111********1111", // Masked for display, encrypted for storage
      "stan": "000001", // 6-Digit STAN
      "expiry": "12/25"
    }
  ]
}
```

**Security & Signature:**
Before uploading, the app must generate an **HMAC-SHA256** signature using the `Shared Secret`.
Construct the signature payload string as:
`protocolVersion|merchantId|terminalId|batchId|timestamp|nonce`

### 4. Background Sync (WorkManager)
- Implement a background worker (using Android `WorkManager`) that runs periodically (e.g., every 15 minutes) or when internet is restored.
- **Endpoint:** `POST /merchant/v1/cashout/braintree`
- **Payload:** Array of Batch objects.
- **Response Handling:**
  - `200 OK`: Mark batches as `SYNCED` in local database.
  - `Error`: Retry later with exponential backoff.

## Technical Constraints
- **Security:** 
  - Never log full PAN (Primary Account Number).
  - Use Android Keystore System to store the `Shared Secret`.
  - Use Encrypted SharedPreferences for sensitive settings.
- **Device Identification:**
  - Use `Settings.Secure.ANDROID_ID` or generate a persistent UUID to uniquely identify the physical device.
  - Display this ID in the Settings screen so the merchant can register it in the web dashboard.
- **Performance:** 
  - Ensure UI remains responsive during database operations.
  - Handle large batch sizes (up to 500 transactions) efficiently.

## Deliverables
- Complete Android Studio Project source code.
- APK file for testing.
- README with setup instructions.
