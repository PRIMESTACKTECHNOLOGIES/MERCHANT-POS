# POS-201.3 Flutter

A professional cross-platform Point of Sale (POS) application built with Flutter, supporting both Android and iOS.

## Features

### ✅ Core Features
- **Cross-Platform**: Single codebase for Android and iOS
- **Offline Mode**: Process payments without internet connection
- **Auto-Sync**: Background sync when connection is restored
- **MyFatoorah Integration**: Generate and send payment links
- **Card Processing**: Manual card entry with encryption
- **6-Digit Redemption Codes**: Redeem payment codes
- **Receipt Generation**: QR codes and shareable receipts

### 🔒 Security
- AES-GCM Encryption for sensitive data
- Secure storage using Keychain (iOS) and Keystore (Android)
- HMAC-SHA256 signatures for API authentication
- Biometric authentication support
- Screenshot prevention (FLAG_SECURE)

### 📱 UI/UX
- Modern Material Design 3
- Professional POS interface
- Responsive numpad for amount entry
- Real-time connection status
- Smooth animations and transitions

## Architecture

```
lib/
├── core/
│   ├── config/          # App configuration
│   ├── theme/           # App themes and colors
│   ├── utils/           # Utilities (HMAC, Encryption, etc.)
│   └── result/          # Result classes for operations
├── data/
│   ├── local/           # SQLite database
│   ├── remote/          # API service (Dio)
│   ├── repository/      # Data repositories
│   └── model/           # Data models
├── domain/
│   ├── entities/        # Domain entities
│   ├── repository/      # Repository interfaces
│   └── usecases/        # Use cases
├── presentation/
│   ├── bloc/            # BLoC state management
│   ├── screens/         # UI screens
│   ├── widgets/         # Reusable widgets
│   └── dialogs/         # Dialog components
└── main.dart            # App entry point
```

## Getting Started

### Prerequisites
- Flutter SDK 3.0.0 or higher
- Dart SDK 3.0.0 or higher
- Android Studio / Xcode

### Installation

1. **Clone the repository**
```bash
cd "C:\Users\user\Desktop\POS OFFLINE SFTWR\flutter_pos_2013"
```

2. **Install dependencies**
```bash
flutter pub get
```

3. **Run the app**
```bash
# For Android
flutter run

# For iOS (requires macOS and Xcode)
flutter run -d ios
```

### Building for Production

#### Android APK
```bash
flutter build apk --release
```

#### Android App Bundle
```bash
flutter build appbundle --release
```

#### iOS
```bash
flutter build ios --release
```

## Configuration

### Backend Server
1. Open the app
2. Go to Terminal Setup
3. Enter your:
   - Merchant ID
   - Terminal ID
   - Secret Key
   - Server URL

### MyFatoorah
1. Go to Settings
2. Select "MyFatoorah Configuration"
3. Enter your API Token
4. Choose Test/Live mode

## API Integration

The app uses Protocol 201.3 for communication with the backend:

### Endpoints
- `POST /merchant/v1/terminal/verify` - Verify terminal credentials
- `POST /merchant/v1/pos/201.3/offline-batch` - Upload offline transactions
- `POST /merchant/v1/pos/201.3/myfatoorah-batch` - Upload MyFatoorah transactions
- `POST /merchant/v1/payment/redeem` - Redeem payment codes

### Security
All requests are signed using HMAC-SHA256:
```
Signature = HMAC-SHA256(
  "201.3|merchantId|terminalId|batchId|timestamp|nonce|transactionCount",
  secretKey
)
```

## Dependencies

| Package | Purpose |
|---------|---------|
| flutter_bloc | State management |
| dio | HTTP client |
| sqflite | Local SQLite database |
| flutter_secure_storage | Secure key storage |
| encrypt | AES encryption |
| crypto | HMAC/SHA functions |
| qr_flutter | QR code generation |
| share_plus | Share functionality |
| url_launcher | Open URLs |
| local_auth | Biometric authentication |
| workmanager | Background tasks |

## License

This project is proprietary software for POS-201.3.

## Support

For issues and support, contact the development team.
