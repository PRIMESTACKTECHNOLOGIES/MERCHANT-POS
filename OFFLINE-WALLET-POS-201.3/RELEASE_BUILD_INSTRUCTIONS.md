# 🔐 Release Build Configuration for POS App

## ⚠️ CRITICAL SECURITY NOTICE

For **live POS transactions** involving real money, you **MUST** use a properly signed release build.

---

## 🎯 What You Need to Do

### Step 1: Generate a Keystore (One-Time)

Open PowerShell and run:

```powershell
keytool -genkey -v -keystore pos-release-key.keystore -alias pos_key -keyalg RSA -keysize 2048 -validity 10000
```

You'll be prompted for:
- **Keystore password**: Choose a strong password
- **Name**: Your name or company
- **Organization**: Your organization
- **City**: Your city
- **State**: Your state
- **Country**: Your country code (e.g., US, AE, IN)

This creates: `pos-release-key.keystore`

**🔒 IMPORTANT:** 
- **BACK UP THIS FILE!** If you lose it, you can't update your app.
- **NEVER share the password!**
- Store in a secure location (password manager, encrypted drive, etc.)

---

### Step 2: Create keystore.properties File

In the `android_pos_app/` folder, create a file named `keystore.properties`:

```properties
storePassword=YOUR_KEYSTORE_PASSWORD
keyPassword=YOUR_KEY_PASSWORD
keyAlias=pos_key
storeFile=../pos-release-key.keystore
```

**⚠️ ADD TO .gitignore!** This file contains secrets.

---

### Step 3: Update build.gradle.kts

Edit `android_pos_app/app/build.gradle.kts`:

Find the `android { }` block and add/replace the `signingConfigs`:

```kotlin
android {
    namespace = "com.pos2013.offline"
    compileSdk = 34

    // Load keystore properties
    val keystorePropertiesFile = rootProject.file("keystore.properties")
    val keystoreProperties = java.util.Properties()
    if (keystorePropertiesFile.exists()) {
        keystoreProperties.load(java.io.FileInputStream(keystorePropertiesFile))
    }

    defaultConfig {
        applicationId = "com.pos2013.offline"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties["keyAlias"] as String?
            keyPassword = keystoreProperties["keyPassword"] as String?
            storeFile = file(keystoreProperties["storeFile"] as String?)
            storePassword = keystoreProperties["storePassword"] as String?
        }
    }

    buildTypes {
        getByName("debug") {
            isDebuggable = false  // Disable debug mode even for debug builds
        }
        
        getByName("release") {
            isMinifyEnabled = true  // Enable ProGuard obfuscation
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("release")
            isDebuggable = false  // CRITICAL: Never allow debugging in release
        }
    }
    
    // ... rest of config
}
```

---

### Step 4: Update ProGuard Rules (Security)

Edit `android_pos_app/app/proguard-rules.pro`:

```proguard
# Keep Retrofit and Gson classes
-keepattributes Signature
-keepattributes *Annotation*
-keep class retrofit2.** { *; }
-keepclasseswithmembers class * {
    @retrofit2.http.* <methods>;
}

# Keep Room database
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class *
-dontwarn androidx.room.paging.**

# Keep model classes
-keep class com.pos2013.offline.data.model.** { *; }
-keep class com.pos2013.offline.data.api.** { *; }

# Keep Kotlin coroutines
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}

# Security: Obfuscate everything else by default
-optimizations !code/simplification/arithmetic,!field/*,!class/merging/*
-allowaccessmodification
-dontpreverify
-repackageclasses ''
```

---

### Step 5: Build Signed Release APK

Now run the build script:

```powershell
.\build_android_app.ps1
```

OR manually:

```powershell
cd android_pos_app
.\gradlew.bat assembleRelease
```

The signed APK will be at:
```
android_pos_app/app/build/outputs/apk/release/app-release.apk
```

---

## 🔒 Security Checklist for Production

Before deploying to production:

- [ ] **Keystore generated** and backed up securely
- [ ] **keystore.properties** created (NOT committed to Git)
- [ ] **Signing configured** in build.gradle.kts
- [ ] **debuggable = false** in release build type
- [ ] **ProGuard enabled** with proper rules
- [ ] **API keys/secrets** removed from code (use environment variables or secure storage)
- [ ] **HTTPS enabled** for production backend
- [ ] **Certificate pinning** considered for extra security
- [ ] **App tested** on multiple devices
- [ ] **Logs disabled** in release build

---

## 🛡️ Additional Security Measures

### 1. Disable Logging in Release

In your code, wrap Log statements:

```kotlin
if (BuildConfig.DEBUG) {
    Log.d("TAG", "Debug message")
}
```

### 2. Use Android Keystore for Sensitive Data

Store API keys and secrets in Android Keystore, not SharedPreferences.

### 3. Implement Certificate Pinning

Prevent man-in-the-middle attacks:

```kotlin
val certificatePinner = CertificatePinner.Builder()
    .add("your-domain.com", "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
    .build()

val client = OkHttpClient.Builder()
    .certificatePinner(certificatePinner)
    .build()
```

### 4. Root Detection (Optional)

Detect rooted devices for extra security:

```kotlin
fun isDeviceRooted(): Boolean {
    return try {
        ProcessBuilder("su").start()
        true
    } catch (e: Exception) {
        false
    }
}
```

---

## 📦 Final APK Properties

Your release APK should have:

| Property | Debug Build | Release Build |
|----------|-------------|---------------|
| **Signed with** | Debug key | Your keystore |
| **debuggable** | true | ❌ false |
| **ProGuard** | Disabled | Enabled |
| **Optimized** | No | Yes |
| **Logs visible** | Yes | Limited |
| **File size** | Larger | Smaller |
| **Production ready** | ❌ NO | ✅ YES |

---

## 🚨 Common Mistakes to Avoid

❌ **Using debug build for production**  
✅ Always use signed release build

❌ **Committing keystore to Git**  
✅ Add to .gitignore immediately

❌ **Hardcoding passwords in build files**  
✅ Use keystore.properties (also gitignored)

❌ **Leaving debuggable=true**  
✅ Explicitly set to false

❌ **No ProGuard obfuscation**  
✅ Enable and configure ProGuard

❌ **Losing keystore backup**  
✅ Store multiple secure backups

---

## 📞 Testing Before Production

1. **Test unsigned release build first** (for functionality)
2. **Verify all features work** (payment, sync, offline mode)
3. **Check logs are disabled** (no sensitive info leaked)
4. **Test on multiple devices** (different Android versions)
5. **Only then sign and deploy**

---

## 🎯 Quick Reference Commands

**Generate keystore:**
```powershell
keytool -genkey -v -keystore pos-release-key.keystore -alias pos_key -keyalg RSA -keysize 2048 -validity 10000
```

**Build release:**
```powershell
cd android_pos_app
.\gradlew.bat assembleRelease
```

**Verify APK signature:**
```powershell
jarsigner -verify -verbose -certs app-release.apk
```

**List APK contents:**
```powershell
unzip -l app-release.apk
```

---

## 📄 Required Files Summary

Create/update these files:

1. ✅ `pos-release-key.keystore` - Your signing key (GENERATE ONCE)
2. ✅ `keystore.properties` - Passwords (KEEP SECRET)
3. ✅ `app/build.gradle.kts` - Signing config
4. ✅ `app/proguard-rules.pro` - Obfuscation rules
5. ✅ `.gitignore` - Exclude keystore and properties

---

## ⚠️ Final Warning

**FOR TESTING ONLY!** 

Even with proper signing, this app is configured for **local development**. For **real production**:

- Change ALL default passwords
- Use HTTPS endpoints only
- Implement proper authentication
- Follow PCI DSS guidelines for payment processing
- Get security audit from professionals

---

**Created:** March 3, 2026  
**Purpose:** Secure Release Build Guide  
**Status:** Production Guidelines ✅
