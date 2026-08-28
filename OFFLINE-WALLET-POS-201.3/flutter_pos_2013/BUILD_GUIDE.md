# POS-201.3 Flutter Build Guide

## Quick Start

### 1. Install Flutter
Make sure you have Flutter SDK installed (3.0.0 or higher):
```bash
flutter doctor
```

### 2. Get Dependencies
```bash
flutter pub get
```

### 3. Build APK (Android)
```bash
# Debug build
flutter build apk

# Release build
flutter build apk --release

# The APK will be at:
# build/app/outputs/flutter-apk/app-release.apk
```

### 4. Build for iOS (requires Mac)
```bash
flutter build ios --release
```

## Project Structure

```
flutter_pos_2013/
├── android/           # Android-specific config
├── ios/              # iOS-specific config
├── lib/              # Main Dart code
│   ├── core/         # Utils, config, theme
│   ├── data/         # Models, API, Database
│   ├── domain/       # Business logic
│   ├── presentation/ # UI screens & widgets
│   └── main.dart     # Entry point
├── pubspec.yaml      # Dependencies
└── README.md
```

## Key Features Implemented

### ✅ Android + iOS Support
- Single codebase for both platforms
- Platform-specific security (Keystore/Keychain)
- Native performance

### ✅ Security
- AES-GCM encryption
- HMAC-SHA256 signatures
- EncryptedSharedPreferences (Android)
- iOS Keychain storage
- Screenshot prevention (both platforms)

### ✅ Offline Functionality
- SQLite database for local storage
- Automatic sync when online
- Background sync with WorkManager

### ✅ Payment Methods
- Card payment (manual entry)
- MyFatoorah payment links
- Cash payments
- Offline orders

### ✅ UI Components
- Professional POS interface
- Animated splash screen
- Numpad for amount entry
- Receipt with QR code
- Connection status indicator

## Dependencies Added

```yaml
dependencies:
  flutter_bloc: ^8.1.3          # State management
  dio: ^5.4.0                   # HTTP client
  sqflite: ^2.3.0              # SQLite
  flutter_secure_storage: ^9.0.0 # Secure storage
  encrypt: ^5.0.1              # Encryption
  crypto: ^3.0.3               # Crypto functions
  qr_flutter: ^4.1.0           # QR codes
  share_plus: ^7.2.1           # Share functionality
  url_launcher: ^6.2.2         # Open URLs
  local_auth: ^2.1.8           # Biometric auth
  workmanager: ^0.5.2          # Background tasks
  connectivity_plus: ^5.0.2    # Network status
  go_router: ^12.1.1           # Navigation
```

## Next Steps

1. **Test on Device**: Run `flutter run` to test on connected device
2. **Configure Backend**: Update server URL in GatewayConfig
3. **Add Icons**: Replace default Flutter icons with your app icons
4. **Sign APK**: Configure signing for release builds
5. **Test Payments**: Test all payment flows thoroughly

## Troubleshooting

### Build Errors
```bash
# Clean and rebuild
flutter clean
flutter pub get
flutter build apk
```

### iOS Issues
```bash
cd ios
pod install --repo-update
cd ..
flutter build ios
```

### Android Permission Issues
Make sure `AndroidManifest.xml` includes all required permissions.

## Release Checklist

- [ ] Update app version in `pubspec.yaml`
- [ ] Configure signing keys for Android
- [ ] Add app icons
- [ ] Test on multiple devices
- [ ] Test offline mode
- [ ] Test payment flows
- [ ] Test sync functionality
- [ ] Verify encryption working
- [ ] Build release APK/AAB
- [ ] Build iOS archive (if needed)

## Contact

For support or questions about the build process.
