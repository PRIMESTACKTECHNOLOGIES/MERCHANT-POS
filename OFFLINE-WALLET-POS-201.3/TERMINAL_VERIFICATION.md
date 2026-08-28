# Terminal Verification System - Production Ready

## Overview

This is the **mandatory authentication step** for any 201.3-compliant POS terminal. Every certified terminal (Ingenico, Verifone, PAX, Castles) must verify with the backend before processing payments.

**Without verification, the terminal cannot:**
- ❌ Process payments
- ❌ Store offline transactions  
- ❌ Sync batches to the server
- ❌ Generate valid HMAC signatures

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TERMINAL VERIFICATION FLOW                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐     ┌──────────────────┐     ┌─────────────────────┐  │
│  │     UI Layer     │     │  Domain Layer    │     │    Data Layer       │  │
│  │                  │     │                  │     │                     │  │
│  │  SetupActivity   │────►│ VerifyTerminal   │────►│    AuthApi          │  │
│  │                  │     │    UseCase       │     │                     │  │
│  │ • Input fields   │◄────│                  │◄────│ • POST /terminal/   │  │
│  │ • Verify button  │     │ • Validation     │     │   verify            │  │
│  │ • Error display  │     │ • API call       │     │ • VerifyRequest     │  │
│  │                  │     │ • Save creds     │     │ - VerifyResponse    │  │
│  └──────────────────┘     └──────────────────┘     └─────────────────────┘  │
│           │                        │                                         │
│           │              ┌─────────┘                                         │
│           │              ▼                                                   │
│           │     ┌──────────────────┐                                         │
│           │     │ TerminalViewModel│                                         │
│           │     │                  │                                         │
│           │     │ • StateFlow      │                                         │
│           │     │ • Error handling │                                         │
│           └────►│ • Loading states │                                         │
│                 └──────────────────┘                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
com.pos2013.offline/
├── domain/usecase/
│   └── VerifyTerminalUseCase.kt      # Business logic, validation, API call
│
├── presentation/viewmodel/
│   └── TerminalViewModel.kt          # UI state management
│
├── data/api/
│   ├── AuthApi.kt                    # Retrofit interface
│   ├── VerifyRequest.kt              # Request DTO
│   └── VerifyResponse.kt             # Response DTO
│
└── ui/
    └── SetupActivity.kt              # Terminal verification screen
```

---

## Verification Flow

```
┌─────────────┐
│    START    │
└──────┬──────┘
       ▼
┌─────────────┐     ┌─────────────┐
│ User enters │────►│  Validate   │
│ credentials │     │   inputs    │
└─────────────┘     └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
       ┌─────────────┐          ┌─────────────┐
       │   Invalid   │          │    Valid    │
       │  show error │          │  continue   │
       └─────────────┘          └──────┬──────┘
                                       ▼
                              ┌─────────────────┐
                              │  POST /merchant/│
                              │  v1/terminal/   │
                              │    verify       │
                              │                 │
                              │ Body: {         │
                              │   merchantId,   │
                              │   terminalId,   │
                              │   secretKey     │
                              │ }               │
                              └────────┬────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              ▼                        ▼                        ▼
       ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
       │   Network   │          │   Invalid   │          │    Valid    │
       │    Error    │          │  Credentials│          │             │
       │             │          │             │          │ 1. Save to  │
       │ Retry with  │          │ Show error  │          │    Shared   │
       │ better msg  │          │ message     │          │    Prefs    │
       └─────────────┘          └─────────────┘          │ 2. Refresh  │
                                                         │    Gateway  │
                                                         │    Config   │
                                                         │ 3. Navigate │
                                                         │    to Main  │
                                                         └─────────────┘
```

---

## API Specification

### Endpoint

```
POST /merchant/v1/terminal/verify
Content-Type: application/json
```

### Request

```json
{
  "merchantId": "MRC-1001",
  "terminalId": "T2013-001",
  "secretKey": "sk_test_terminal_secret_key"
}
```

### Success Response (200 OK)

```json
{
  "valid": true,
  "merchantId": "MRC-1001",
  "message": "Terminal verified successfully"
}
```

### Error Response (200 OK with valid=false)

```json
{
  "valid": false,
  "message": "Invalid terminal credentials",
  "error": "TERMINAL_NOT_FOUND"
}
```

---

## Error Handling

The system handles these specific error scenarios:

| Error Code | Cause | User Message |
|------------|-------|--------------|
| `NETWORK_ERROR` | No internet / timeout | "📡 No internet connection" |
| `SERVER_ERROR` | HTTP 5xx | "🔧 Server error: HTTP 500" |
| `INVALID_CREDENTIALS` | valid=false | "🔐 Invalid credentials" |
| `EMPTY_RESPONSE` | Body is null | "❌ Empty response" |
| `UNKNOWN` | Unexpected error | "❌ Verification failed" |

---

## Usage

### From Activity (with ViewModel)

```kotlin
class SetupActivity : AppCompatActivity() {
    
    private val viewModel: TerminalViewModel by viewModels {
        TerminalViewModelFactory(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Observe state
        lifecycleScope.launch {
            viewModel.state.collect { state ->
                when (state) {
                    is TerminalVerificationState.Loading -> showLoading(true)
                    is TerminalVerificationState.Success -> navigateToMain()
                    is TerminalVerificationState.Error -> showError(state.message)
                    else -> { /* Idle */ }
                }
            }
        }
        
        // Trigger verification
        viewModel.verifyTerminal(
            merchantId = "MRC-1001",
            terminalId = "T2013-001",
            secretKey = "sk_test_xxx"
        )
    }
}
```

### Direct UseCase (for testing)

```kotlin
val useCase = VerifyTerminalUseCase(context)

val result = useCase(
    merchantId = "MRC-1001",
    terminalId = "T2013-001",
    secretKey = "sk_test_xxx"
)

when (result) {
    is VerifyTerminalUseCase.Result.Success -> {
        println("Verified: ${result.merchantId}")
    }
    is VerifyTerminalUseCase.Result.Error -> {
        println("Failed: ${result.message}")
    }
}
```

---

## Data Storage

After successful verification, these values are saved to SharedPreferences:

```kotlin
// pos_prefs
{
  "merchant_id": "MRC-1001",
  "terminal_id": "T2013-001",
  "secret_key": "sk_test_xxx",
  "device_registered": true
}
```

And immediately available via `GatewayConfig`:

```kotlin
GatewayConfig.MERCHANT_ID         // "MRC-1001"
GatewayConfig.TERMINAL_ID         // "T2013-001"
GatewayConfig.GATEWAY_SECRET_KEY  // "sk_test_xxx"
```

---

## Security Notes

1. **Secret Key** is never displayed in UI (use password field)
2. **Secret Key** is stored in private SharedPreferences
3. **HTTPS required** for production (enforced by backend)
4. **Rate limiting** should be implemented on backend
5. **Device binding** can be added (IMEI, serial, etc.)

---

## Testing

### Test with Local Server

```kotlin
viewModel.verifyTerminal(
    merchantId = "MRC-1001",
    terminalId = "T2013-001",
    secretKey = "test_secret",
    serverUrl = "http://192.168.1.100:3000/"
)
```

### Test with Production

```kotlin
viewModel.verifyTerminal(
    merchantId = "MRC-PROD-001",
    terminalId = "T2013-PROD-001",
    secretKey = "sk_live_xxx",
    serverUrl = "https://api.yourdomain.com/"
)
```

---

## Integration with Other Features

After verification succeeds:

1. **SyncWorker** starts automatically (scheduled in `PosApplication`)
2. **Payment processing** is unlocked
3. **HMAC signatures** can be generated
4. **Offline transactions** can be stored and synced

---

## Production Checklist

- [x] Terminal verification required before payment
- [x] Credentials saved securely
- [x] GatewayConfig refreshed after verification
- [x] Error messages are user-friendly
- [x] Network errors handled gracefully
- [x] Loading states prevent double-submit
- [x] Server URL configurable for testing
- [x] Auto-navigate to main on success

---

## Next Steps

Your terminal verification is now production-ready! Choose next:

1. **Payment Capture Flow** - Build the UI that creates transactions
2. **MyFatoorah Integration** - Real payment processing
3. **Receipt Printing** - Auto-print after payment
4. **Settlement Reports** - Daily batch summary view

---

**Your POS terminal now authenticates like a real payment terminal! 🎉**
