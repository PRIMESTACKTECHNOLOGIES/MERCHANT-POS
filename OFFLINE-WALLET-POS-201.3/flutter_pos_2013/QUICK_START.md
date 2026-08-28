# POS-201.3 Flutter - Quick Start Guide

## 🚀 Build Your APK in 3 Steps

### Step 1: Install Flutter
Make sure Flutter is installed:
```bash
flutter doctor
```

### Step 2: Get Dependencies
```bash
flutter pub get
```

### Step 3: Build APK
**Option A: Using PowerShell Script (Recommended)**
```powershell
.\build_release.ps1
```

**Option B: Manual Build**
```bash
flutter build apk --release
```

Your APK will be at:
```
build\app\outputs\flutter-apk\app-release.apk
```

---

## 📱 Install on Device

### Using ADB
```bash
adb install build\app\outputs\flutter-apk\app-release.apk
```

### Manual Install
1. Copy APK to your device
2. Enable "Install from Unknown Sources"
3. Tap the APK to install

---

## 🎨 Customize Branding

Edit `lib/core/config/branding_config.dart`:

```dart
class BrandingConfig {
  static const String appName = 'Your POS Name';
  static const String companyName = 'Your Company';
  static const Color primaryColor = Color(0xFFYourColor);
  // ... more options
}
```

Add your logo to `assets/images/`:
- `logo_light.png` - Light mode logo
- `logo_dark.png` - Dark mode logo
- `logo_splash.png` - Splash screen logo

---

## 🔧 Features Available

### ✅ Core Features
- Offline transactions
- MyFatoorah payment links
- Card processing (manual entry)
- 6-digit code redemption
- Receipt generation with QR
- Background sync

### ✅ Advanced Features
- **Reports & Analytics** - Daily/weekly/monthly reports
- **Multi-Merchant** - Switch between merchant accounts
- **Export Data** - CSV export for transactions
- **Secure Storage** - Encrypted data storage
- **Biometric Auth** - Face ID / Fingerprint

---

## 📂 Project Structure

```
lib/
├── core/          # Config, theme, utils
├── data/          # Models, API, database
├── domain/        # Business logic
└── presentation/  # UI screens & widgets
```

---

## 🔐 Security Features

- AES-GCM encryption
- HMAC-SHA256 signatures
- Secure key storage (Keychain/Keystore)
- Screenshot prevention
- No CVV storage (PCI compliant)

---

## 🆘 Troubleshooting

### Build Errors
```bash
flutter clean
flutter pub get
flutter build apk
```

### Dependency Issues
```bash
flutter pub upgrade
```

### iOS Issues (Mac only)
```bash
cd ios
pod install --repo-update
```

---

## 📞 Support

For issues and feature requests, contact the development team.

---

## 🎉 Next Steps

1. ✅ Build APK
2. ✅ Test on device
3. 🎨 Customize branding
4. 🔌 Connect to your backend
5. 🚀 Deploy to Play Store

**Your POS app is ready!**
