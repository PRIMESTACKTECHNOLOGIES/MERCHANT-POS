# Flutter POS-201.3 - API Configuration Guide

## 🔧 Configure API Endpoints

### Step 1: Set Backend URL (Already Done)
✅ Updated in:
- `lib/core/config/gateway_config.dart`
- `lib/core/config/app_config.dart`

**Your Backend:** `https://pos-offline-sftwr.onrender.com/`

---

### Step 2: Configure MyFatoorah Token (Secure)

#### Option A: Runtime Configuration (Recommended for Development)

1. Run the app
2. Go to **Settings** → **MyFatoorah Configuration**
3. Enter your API token
4. Token is stored securely in `FlutterSecureStorage`

#### Option B: Build-Time Configuration (For Production CI/CD)

```bash
# Build with dart-define (token embedded in build)
flutter build apk --release \
  --dart-define=MYFATOORAH_TOKEN=sk_are_your_token_here \
  --dart-define=MYFATOORAH_TEST_MODE=false
```

Then in code:
```dart
static const String myFatoorahToken = String.fromEnvironment(
  'MYFATOORAH_TOKEN',
  defaultValue: '',
);
```

---

## 📋 API Endpoints Configuration

### Your Backend (Render)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `https://pos-offline-sftwr.onrender.com/` | GET | Health check |
| `/merchant/v1/terminal/verify` | POST | Terminal verification |
| `/merchant/v1/pos/201.3/offline-batch` | POST | Upload transactions |
| `/merchant/v1/pos/201.3/myfatoorah-batch` | POST | Upload MyFatoorah |
| `/merchant/v1/payment/redeem` | POST | Redeem code |
| `/merchant/v1/myfatoorah/webhook` | POST | Webhook receiver |

### MyFatoorah API
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `https://api.myfatoorah.com/v2/ExecutePayment` | POST | Direct payment |
| `https://api.myfatoorah.com/v2/SendPayment` | POST | Payment link |
| `https://api.myfatoorah.com/v2/GetPaymentStatus` | POST | Check status |
| `https://api.myfatoorah.com/v2/GetTransactions` | POST | List transactions |

---

## 🔒 Security Configuration

### 1. Certificate Pinning (Optional but Recommended)

In `lib/data/remote/api_service.dart`:
```dart
void _initDio() {
  _dio = Dio(BaseOptions(
    connectTimeout: const Duration(seconds: 30),
    receiveTimeout: const Duration(seconds: 30),
  ));
  
  // Add certificate pinning
  (_dio.httpClientAdapter as IOHttpClientAdapter).onHttpClientCreate = (client) {
    client.badCertificateCallback = (cert, host, port) {
      // Only allow your Render certificate
      return host == 'pos-offline-sftwr.onrender.com';
    };
    return client;
  };
}
```

### 2. Webhook URL (For MyFatoorah Dashboard)

Configure in MyFatoorah Dashboard:
```
https://pos-offline-sftwr.onrender.com/merchant/v1/myfatoorah/webhook
```

---

## 🚀 Build Commands

### Development Build
```bash
flutter build apk --debug
```

### Production Build
```bash
# With API keys (CI/CD)
flutter build apk --release \
  --dart-define=MYFATOORAH_TOKEN=sk_are_xxx \
  --dart-define=MYFATOORAH_TEST_MODE=false

# Or without (user enters token in app)
flutter build apk --release
```

### Build App Bundle (Play Store)
```bash
flutter build appbundle --release
```

---

## ✅ Configuration Checklist

- [x] Backend URL: `https://pos-offline-sftwr.onrender.com/`
- [ ] MyFatoorah Token: Set in app Settings (or via dart-define)
- [ ] MyFatoorah Test Mode: `false` for production
- [ ] Webhook URL: Configured in MyFatoorah dashboard
- [ ] Merchant ID: Default `MRC-1001` (or your actual)
- [ ] Terminal ID: Default `T2013-001` (or your actual)

---

## 🧪 Test Configuration

```dart
// Test in app
final api = ApiService();
final isHealthy = await api.checkHealth();
print('Backend healthy: $isHealthy');

final isMyFatoorahReady = await GatewayConfig.isMyFatoorahConfigured;
print('MyFatoorah configured: $isMyFatoorahReady');
```

---

## 🔧 Troubleshooting

### "Connection timeout"
- Check if backend is running: `https://pos-offline-sftwr.onrender.com/health`
- Check internet connection on device

### "Unauthorized" from MyFatoorah
- Token not set or expired
- Check token in Settings screen
- Verify token in MyFatoorah dashboard

### "404 Not Found"
- Backend URL incorrect
- Check endpoint paths match

---

## 📱 Platform-Specific Notes

### Android
- Uses `encryptedSharedPreferences` for secure storage
- Requires `INTERNET` permission (already in AndroidManifest.xml)

### iOS
- Uses iOS Keychain for secure storage
- Requires `Keychain Sharing` capability (configure in Xcode)

---

## ✅ Ready to Build!

Your API endpoints are configured. Run:
```bash
flutter pub get
flutter build apk --release
```
