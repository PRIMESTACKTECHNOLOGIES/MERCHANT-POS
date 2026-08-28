# POS Offline System - Live Setup Guide

This guide explains how to run the **Live C# Backend** and the **Android POS App** for real-time transaction redemption.

## 1. C# Live Backend (The "Bank")

This Minimal API acts as the live authorization server. It holds a list of valid payment codes in memory.

### Prerequisites
- .NET 8.0 SDK installed.

### How to Run
1. Open a terminal in `backend_csharp_api/`.
2. Run the following command:
   ```bash
   dotnet run
   ```
3. The server will start at `http://localhost:5000`.
   - Endpoint: `POST http://localhost:5000/api/payment2013/redeem`

### Pre-loaded Codes
The server starts with these valid codes (see `PaymentCode.cs`):
- **123456** (Amount: 100.00)
- **999999** (Amount: 50.50)
- **888888** (Amount: 10.00)

## 2. Android POS App

This is the native Kotlin app that acts as the POS terminal.

### Prerequisites
- Android Studio.

### How to Run
1. Open Android Studio.
2. Select **Open** and choose the `mobile_android_src` folder.
3. Sync Gradle (it might prompt to create a `build.gradle` if missing - see below).
4. Run on an **Android Emulator** (recommended).

### Important: Gradle Setup
If you are importing this as a fresh project, ensure you have the standard `build.gradle.kts` files.
The project source is structured, but you might need to create a project wrapper if Android Studio doesn't recognize it immediately.

**Recommended:**
1. Create a **New Project** in Android Studio (No Activity).
2. Copy the contents of `mobile_android_src` into the new project's `app/src/main/java` and `app/src/main/res` folders.
3. Add these dependencies to `app/build.gradle.kts`:
   ```kotlin
   implementation("com.squareup.retrofit2:retrofit:2.9.0")
   implementation("com.squareup.retrofit2:converter-gson:2.9.0")
   implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.6.2")
   implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
   implementation("androidx.room:room-runtime:2.6.1")
   kapt("androidx.room:room-compiler:2.6.1") // or ksp
   implementation("androidx.room:room-ktx:2.6.1")
   implementation("androidx.work:work-runtime-ktx:2.9.0")
   ```

### Connecting to Backend
- **IMPORTANT:** I have automatically updated the API URL to your current local IP: `http://192.168.1.160:5000/`.
- Ensure your Phone and PC are on the **Same Wi-Fi Network**.
- If your IP changes, you must update `mobile_android_src/data/api/PosApi.kt` and `mobile_android_src/workers/SyncWorker.kt`.

## 3. Testing a Transaction on Real Phone

1. **PC:** Start the C# Backend (`dotnet run` in `backend_csharp_api/`).
2. **PC:** Start the Node.js Backend (`npm run dev` in `backend/`).
3. **Phone:** Open the Android App.
4. **Phone:** Enter Code: `123456`
5. **Phone:** Enter Amount: `100`
6. **Phone:** Tap **Confirm Payment**.
7. **Result:** You should see "✅ Success".
8. **Verify:** Check the C# terminal on your PC; it should show the request log.
