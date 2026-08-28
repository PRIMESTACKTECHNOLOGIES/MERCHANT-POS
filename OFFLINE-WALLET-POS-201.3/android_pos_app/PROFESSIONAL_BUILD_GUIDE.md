# Professional Android POS App Build Guide

## 🚀 Architecture Overview

This Android app follows **MVVM + Clean Architecture** with:
- **Secure Storage**: AES-256 encrypted preferences for API tokens
- **Offline-First**: Room database with WorkManager sync
- **Professional UI**: Material Design 3 components
- **Receipt Generation**: PDF receipts with share functionality
- **ProGuard**: Code obfuscation for release builds

## 📁 Project Structure

```
app/src/main/java/com/pos2013/offline/
├── data/
│   ├── local/
│   │   ├── AppDatabase.kt          # Room database
│   │   ├── SecureStorage.kt        # Encrypted preferences
│   │   ├── dao/
│   │   │   └── TransactionDao.kt   # Room DAO
│   │   └── entity/
│   │       └── TransactionEntity.kt # Transaction model
│   ├── repository/
│   │   └── TransactionRepository.kt # Data operations
│   └── api/                        # Retrofit API interfaces
├── viewmodel/
│   └── PosViewModel.kt             # UI state management
├── ui/
│   ├── LauncherActivity.kt         # Splash/Entry
│   ├── MainActivity.kt             # POS screen
│   ├── ReceiptActivity.kt          # Receipt display
│   ├── LoginActivity.kt            # Authentication
│   ├── SetupActivity.kt            # First-time setup
│   ├── SettingsActivity.kt         # Configuration
│   └── HistoryActivity.kt          # Transaction history
├── util/
│   └── ReceiptGenerator.kt         # PDF receipt generation
└── PosApplication.kt               # Application class
```

## 🔐 Security Features

1. **EncryptedSharedPreferences**: All sensitive data encrypted at rest
2. **ProGuard**: Code obfuscation in release builds
3. **Certificate Pinning**: Can be added for API security
4. **Root Detection**: Can be implemented for additional security

## 🏗️ Building Release APK

### Step 1: Create Keystore

```bash
# Navigate to android_pos_app directory
cd android_pos_app

# Generate keystore
keytool -genkey -v \
  -keystore pos-release-key.keystore \
  -alias pos-release-key \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

### Step 2: Configure Signing

Copy the template and update:
```bash
cp keystore.properties.template keystore.properties
```

Edit `keystore.properties`:
```properties
storeFile=pos-release-key.keystore
storePassword=your_keystore_password
keyAlias=pos-release-key
keyPassword=your_key_password
```

### Step 3: Build Release APK

```bash
# Using Gradle Wrapper
./gradlew assembleRelease

# Or in Android Studio:
# Build → Generate Signed Bundle/APK → APK
```

Output: `app/build/outputs/apk/release/app-release.apk`

### Step 4: Verify Build

```bash
# Check APK info
aapt dump badging app/build/outputs/apk/release/app-release.apk

# Verify signing
jarsigner -verify -verbose -certs app-release.apk
```

## 📱 App Configuration

### First Time Setup

1. **Install APK** on Android device
2. **Allow Unknown Sources** if prompted
3. **Complete Setup**:
   - Enter Server URL (e.g., `http://192.168.1.100:3000`)
   - Enter Merchant ID (e.g., `MRC-1001`)
   - Register Terminal
   - Save configuration

### Settings

Navigate to Settings to configure:
- **MyFatoorah API Token**: Your live/test token
- **Test Mode**: Enable for sandbox testing
- **Offline Mode**: Allow transactions without internet

## 🧪 Testing

### Debug Build
```bash
./gradlew assembleDebug
```

### Run Tests
```bash
# Unit tests
./gradlew test

# Instrumented tests
./gradlew connectedAndroidTest
```

## 📦 Release Checklist

- [ ] Keystore created and secured
- [ ] `keystore.properties` configured
- [ ] ProGuard rules verified
- [ ] Version code incremented
- [ ] Release notes prepared
- [ ] APK signed and verified
- [ ] Installation tested on device
- [ ] Offline sync tested
- [ ] Receipt generation tested

## 🔧 Troubleshooting

### Build Errors

**Error: Keystore file not found**
- Ensure `pos-release-key.keystore` exists in `android_pos_app/`
- Check `keystore.properties` path

**Error: ProGuard warnings**
- Add `-dontwarn` rules for third-party libraries
- Check `app/proguard-rules.pro`

### Runtime Issues

**App crashes on launch**
- Check AndroidManifest.xml permissions
- Verify Room database migration
- Check Timber initialization

**Cannot connect to server**
- Verify `android:usesCleartextTraffic="true"` in manifest
- Check server URL in settings
- Verify network permissions

## 📊 Performance Optimization

1. **Minify Enabled**: `isMinifyEnabled = true`
2. **Shrink Resources**: `isShrinkResources = true`
3. **ProGuard**: Code obfuscation and optimization
4. **Room**: Efficient local caching
5. **WorkManager**: Background sync with constraints

## 🛡️ Security Best Practices

1. **Never commit keystore** to version control
2. **Use encrypted storage** for all sensitive data
3. **Enable ProGuard** for release builds
4. **Validate all inputs** before processing
5. **Implement certificate pinning** for production

## 📄 License

This app is part of the POS Offline Software system.
