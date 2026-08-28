# 🚀 Quick Setup - Environment Variable Method (RECOMMENDED)

## ✅ Why This Method is Better

- 🔒 **More Secure** - Passwords stored in Windows, not files
- 🚀 **CI/CD Ready** - Easy to automate builds
- 📦 **Cleaner** - No keystore.properties files to manage
- 🛡️ **Git-Safe** - Nothing to accidentally commit

---

## ⚡ **SETUP IN 5 MINUTES**

### Step 1: Generate Keystore (One-Time)

Open PowerShell as **Administrator**:

```powershell
cd "c:\Users\user\Desktop\POS OFFLINE SFTWR"
keytool -genkey -v -keystore pos-release-key.keystore -alias pos_key -keyalg RSA -keysize 2048 -validity 10000
```

You'll be prompted for:
- **Keystore password** → Choose strong password
- **Name** → Your name/company
- **Organization** → Your organization
- **City, State, Country** → Your location

✅ Creates: `pos-release-key.keystore`

**🔒 BACK UP THIS FILE IMMEDIATELY!** Save to:
- External drive
- Cloud storage (encrypted)
- Password manager attachment

---

### Step 2: Set Environment Variables (Run Once)

Still in **Administrator PowerShell**:

```powershell
# Set these permanently for your user
[System.Environment]::SetEnvironmentVariable("POS_KEYSTORE_PATH", "C:\Users\user\Desktop\POS OFFLINE SFTWR\pos-release-key.keystore", "User")

[System.Environment]::SetEnvironmentVariable("POS_KEYSTORE_PASSWORD", "YOUR_PASSWORD_HERE", "User")

[System.Environment]::SetEnvironmentVariable("POS_KEY_ALIAS", "pos_key", "User")

[System.Environment]::SetEnvironmentVariable("POS_KEY_PASSWORD", "YOUR_PASSWORD_HERE", "User")
```

**Replace `YOUR_PASSWORD_HERE` with your actual passwords!**

---

### Step 3: Verify Environment Variables

Close and reopen PowerShell, then run:

```powershell
echo $env:POS_KEYSTORE_PATH
echo $env:POS_KEYSTORE_PASSWORD
echo $env:POS_KEY_ALIAS
echo $env:POS_KEY_PASSWORD
```

Should show your values (password will be masked).

---

### Step 4: Update build.gradle.kts

Edit: `android_pos_app/app/build.gradle.kts`

Add inside the `android { }` block:

```kotlin
android {
    namespace = "com.pos2013.offline"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.pos2013.offline"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    // ADD THIS SIGNING CONFIG SECTION
    signingConfigs {
        create("release") {
            storeFile = file(System.getenv("POS_KEYSTORE_PATH"))
            storePassword = System.getenv("POS_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("POS_KEY_ALIAS")
            keyPassword = System.getenv("POS_KEY_PASSWORD")
        }
    }

    buildTypes {
        getByName("debug") {
            isDebuggable = false
        }
        
        getByName("release") {
            isMinifyEnabled = true
            shrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("release")
            isDebuggable = false
        }
    }
    
    // ... rest of config stays the same
}
```

---

### Step 5: Build Release APK

Now run the build script:

```powershell
.\build_android_app.ps1
```

It will:
- ✅ Check environment variables
- ✅ Build signed release APK
- ✅ Show you where it is

**Output:** `android_pos_app/app/build/outputs/apk/release/app-release.apk`

---

### Step 6: Verify Signature

```powershell
cd android_pos_app\app\build\outputs\apk\release
jarsigner -verify -verbose -certs app-release.apk
```

Should show: **"jar verified"**

---

## 🎯 **Quick Reference Commands**

### Set All Environment Variables (Copy-Paste):

```powershell
# Run as Administrator
$keystorePath = "C:\Users\user\Desktop\POS OFFLINE SFTWR\pos-release-key.keystore"
$keystorePassword = "YOUR_PASSWORD"
$keyAlias = "pos_key"
$keyPassword = "YOUR_PASSWORD"

[System.Environment]::SetEnvironmentVariable("POS_KEYSTORE_PATH", $keystorePath, "User")
[System.Environment]::SetEnvironmentVariable("POS_KEYSTORE_PASSWORD", $keystorePassword, "User")
[System.Environment]::SetEnvironmentVariable("POS_KEY_ALIAS", $keyAlias, "User")
[System.Environment]::SetEnvironmentVariable("POS_KEY_PASSWORD", $keyPassword, "User")

Write-Host "✅ Environment variables set!" -ForegroundColor Green
```

### Check If Variables Are Set:

```powershell
Write-Host "Keystore Path: $env:POS_KEYSTORE_PATH"
Write-Host "Keystore Alias: $env:POS_KEY_ALIAS"
Write-Host "Password Set: $(if($env:POS_KEYSTORE_PASSWORD){'Yes'}else{'No'})"
```

### Remove Variables (If Needed):

```powershell
[System.Environment]::SetEnvironmentVariable("POS_KEYSTORE_PATH", $null, "User")
[System.Environment]::SetEnvironmentVariable("POS_KEYSTORE_PASSWORD", $null, "User")
[System.Environment]::SetEnvironmentVariable("POS_KEY_ALIAS", $null, "User")
[System.Environment]::SetEnvironmentVariable("POS_KEY_PASSWORD", $null, "User")
```

---

## 🔧 **Troubleshooting**

### Build Fails: "Keystore file not found"
**Solution:** Check path is correct:
```powershell
Test-Path $env:POS_KEYSTORE_PATH
# Should return True
```

### Build Fails: "Signing failed"
**Solutions:**
- Verify passwords are correct
- Check keystore alias matches (`pos_key`)
- Ensure keystore file isn't corrupted

### Can't Set Environment Variables
**Alternative:** Set via Windows GUI:
1. Right-click **This PC** → **Properties**
2. **Advanced system settings**
3. **Environment Variables**
4. Add under "User variables"

### Gradle Can't Find Variables
**Fix:** Restart Android Studio after setting variables

---

## 📋 **Checklist**

Before first build:

- [ ] Keystore generated (`pos-release-key.keystore`)
- [ ] Keystore backed up securely
- [ ] Environment variables set (all 4)
- [ ] Verified variables with `echo` commands
- [ ] Updated `build.gradle.kts` with signing config
- [ ] Restarted PowerShell/Android Studio

---

## 🎉 **Advantages of This Method**

| Feature | Properties File | Environment Variables |
|---------|----------------|----------------------|
| **Security** | ❌ File can be committed | ✅ Stored in OS |
| **CI/CD** | ❌ Need to exclude from Git | ✅ Native support |
| **Multi-dev** | ❌ Each dev needs file | ✅ Set per-user |
| **Automation** | ❌ File management | ✅ Easy scripting |
| **Cleanup** | ❌ Must delete files | ✅ Just unset vars |

---

## 🔐 **Security Best Practices**

### DO:
✅ Use strong passwords (16+ characters)  
✅ Back up keystore to multiple locations  
✅ Use environment variables (this method)  
✅ Set variables as User-level (not System)  
✅ Store passwords in password manager  

### DON'T:
❌ Commit keystore to Git  
❌ Hardcode passwords in scripts  
❌ Share keystore passwords via email  
❌ Use weak passwords  
❌ Lose your keystore backup  

---

## 📞 **Next Steps After Build**

Once APK is built successfully:

1. **Transfer to POS device** (USB, network share, etc.)
2. **Enable Unknown Sources** on device
3. **Install APK**
4. **Update API URL** to your backend IP
5. **Test transactions** with codes: `123456`, `999999`, `888888`

---

## 🎯 **Summary**

Your updated script now:
- ✅ Checks for environment variables
- ✅ Builds signed release APK automatically
- ✅ Provides helpful error messages
- ✅ Shows security features enabled
- ✅ Ready for production use

**Just run:** `.\build_android_app.ps1`

---

**Method:** Environment Variables (Recommended)  
**Status:** Production Ready ✅  
**Protocol:** 201.6 Live Transactions
