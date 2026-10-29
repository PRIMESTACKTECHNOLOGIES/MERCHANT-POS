# Primestack POS — Android Terminal App

Full-featured, **standalone** Android POS terminal app with 1:1 connectivity parity with the web dashboard. Every charge flow (101.1 Voice Auth, 101.6 Online EMV, 201.3 Offline Capture), wallets, batches, settlements, receipts, vault/virtual cards, audit/recon/reports — everything on device. Shares the EXACT same backend as the web dashboard (NodeExpressTypeScript at `../backend/` node server — no divergence.

---

## Stack

| Layer        | Tech                                                                 |
|--------------|----------------------------------------------------------------------|
| Language     | Kotlin 1.9.24 (strict JVM target 17)                                |
| Gradle       | AGP 8.6, Gradle 8.10, version catalog `gradle/libs.versions.toml      |
| UI           | Material Components 1.12.0 / AppCompat Material3 themes; programmatic views (no XML layouts for screens) + optional XML theme resources
| Architecture | MVVM: `Activity → ViewModel (LiveData + viewModelScope) → TransactionRepository → Room DB KSP v8 (migrations 1→8) + Retrofit 2.11 / OkHttp4 4.12` |
| Background   | WorkManager 2.10 (15-min periodic + `SyncForegroundService` (dataSync foreground type) |
| Payments HW    | ACS USB Smart Card AAR (libs/acssmc-1.1.7.aar) + Android NFC reader (built-in HCE VirtualCardHostApduService + EMV kernel 8-file `app/src/main/java/com/pos2013/offline/emv/`|
| Thermal      | ESC/POS 58mm & 80mm builders `ReceiptThermal.build58/build80 utils.Helpers.kt` |
| Connectivity | 18 Retrofit interfaces matching backend routes (see `data/api/PosApi.kt`) |

---

## Quick Start

### 1. Open in Android Studio

1. **Android Studio → File → Open → `F:\POS ORGINAL\android_pos_app\`

2. **IMPORTANT — Use the **Studio JDK, NOT your system JDK 8. AGP 8.6 requires JDK >=17
- File → Settings → Build,Execution → Build Tools → Gradle → Gradle JDK → pick **"Embedded JDK (17+ or use the Studio 21 path below
  ```
  C:\Program Files\Android\Android Studio\jbr
  ```

### 2. Start the backend FIRST

Backend → `cd ../backend && npm run dev` (starts the HTTP server typically3000. 

### 3. Backend URL settings by environment

| Running From      | Backend URL in Settings |
|--------------------------|--------------------------|
| Android Emulator         | `http://10.0.2.2:3000`  |
| Physical device (Wi-Fi LAN    | `http://<your-PC-LAN-IP:3000` or run `adb reverse tcp:3000 tcp:3000` for USB debugging then use `http://localhost:3000 |

### 4. Build & install

Command line (PowerShell or from the Gradle inside the Studio):

```powershell
Set-Location "F:\POS ORGINAL\android_pos_app"
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
$env:PATH="$env:JAVA_HOME\bin;$env:PATH"

# Debug APK → app/build/outputs/apk/debug/app-debug.apk
& .\gradlew.bat assembleDebug --no-daemon "-Dorg.gradle.java.home=$env:JAVA_HOME"

# Install to connected device / emulator
& "C:\Users\metat\AppData\Local\Android\Sdk\platform-tools\adb.exe" install -r app\build\outputs\apk\debug\app-debug.apk

# Lint (0 errors expected; 300+ warnings are OK for now)
& .\gradlew.bat lintDebug --no-daemon "-Dorg.gradle.java.home=$env:JAVA_HOME"
```

---

## Screens / Features (28 activities, manifest→ 1:1 web parity)

1. Onboarding (first-run only → writes `onboarded_v1=true` SharedPref) → 2. Login (JWT to `pos_settings` SharedPrefs

| Group            | Activities                                                                                                   | Backend Routes Covered |
|------------------|----------------------------------------------------------------------------------------------------------------|----------------------|
| Charge           | MainActivity, DashboardActivity | `/pos/v1/charge` `/auth/login` `/dashboard/v1/stats` |
| Operations       | Batches, Settlements, Transactions, VerifyTransaction | Batches close /tx lookups /settlement list,transactionlist,verify by authCode/stan/rrn/txnId
| Receipts         | ReceiptsActivity                        | list +view/print/share ESC/POS 58/80mm|
| Wallets/Transfers | WalletsActivity, WalletTransferActivity(runtime creds popup for fundProviderEndpoint+APIKey before ledger credit) | merchant/customer wallets, internal + external via Global Payments UCP adapter at `../backend/`
| CRM / Inventory | Customers (create topup, Products (CRUD+ search), Inventory stockadj), Terminals register, Pairing (pairTerminal id) | all DTO field1:1 with backend PosApi
| FinOps / Vault   | HotWallet, CryptoWallets, Payouts, VaultDashboard, VirtualCards (issue freeze unfreeze terminate)                | all mapped DTO exact DTO names from PosApi |
| Governance       | AuditTrail (SHA-256 audit hashed chain-of-custody rows), Reconciliation, Reports (daily/X-daily generate CSV run) | audit, recons list |
| Payment Methods & DeviceSecurity | togglePaymentMethodsActivity, PrinterActivity (58mm ESC previewESC print preview print test ESC print toprinteresc/pos test receipt), DeviceSecurity (logout, TOTP toggle, API rotate placeholder |
| Settings | `SettingsActivity` server URL, JWT, merchant/terminal IDs, TEST_1USD_SANDBOX toggle, processor_live default_currency, processor

---

## Connectivity parity — zero-divergence guarantee (same web & mobile → same backend payloads)

All Retrofit interface methods in [PosApi.kt](app/src/main/java/com/pos2013/offline/data/api/PosApi.kt) match:
- `amountMinor` Long minor-units convention, no `amountMajor` in Retrofit layer
- `snake_case` → backend fields: `merchant_id`, `terminal_id` for 201.3 capture/batch routes
- All 201.3 offline DTOs `OfflineSaleTransaction` / `OfflineSaleRequest` single owner → package → `data.api`

Backend Node (../backend/src/**/*controller|*router) — mobile hits `/pos/v1/capture2013`, `/merchant/v1/*`, `/wallet/*`, `/auth/*`, `/api/health` exactly the web.

Auth: `AuthInterceptor` pulls `jwt_token` from `pos_settings` SharedPreferences → Bearer header.

---

## TEST_1USD_SANDBOX $1.00 live end-to-end (from backend [vaultOmnibus.service.ts](file:///F:/POS%20ORGINAL/backend/src/services/vaultOmnibus.service.ts):

1. Settings → enable "TEST_1USD_SANDBOX"
2. Backend `.env` at [backend/.env](file:///F:/POS%20ORGINAL/backend/.env) lines 15,21-23 → Global Payments UCP client: secret: keys set + `TEST_1USD_SANDBOX=true`
3. Run $1.00 USD transaction with real debit card → backend performs real OAuth `/oauth/token → `/charges` HTTP POST → ledger update customer wallet → merchant wallet → ✅

### SharedPref keys (`pos_settings`, 12 keys:

```
server_url, jwt_token, admin_username, merchant_id, terminal_id, secret_key, require_backend_connection, last_stan, default_currency, tfa_enabled, terminal_name, processor_live, onboarded_v1
```

---

## Project map + gradle assembleDebug lintDebug passed, 0 errors

| Stage            | Line count of activities classes confirmed via grep 28 concrete Activities, 28 `<activity>` in AndroidManifest` ✓
| Room AppDatabase| version8 with 7 migrations 1→8 & 9 DAOs wired (transactions, walletTopups, dashboardCache, receiptCache, syncQueue, localAudit, pairedTerminals, productCache + walletTopup entity)
| EMV kernel AAR, 8 emv files, NFC + HCE VirtualCard HCE service (acs + NFC foreground reader both functional
| Navigation `SyncWorker 15-min WorkManager periodic + SyncForegroundService60s dataSync foreground

---

## Troubleshooting

| Symptom                               | Fix                                                                                                        |
|---------------------------------------|------------------------------------------------------------------------------------------------------------|
| `compileDebugKotlin "Unresolved reference" on old DTO fields | grep actual data class in PosApi.kt — only use fields. Activities rewritten against PosApi. No phantom fields!  |
| `ClassVersion AGP requires JDK17+ JDK=17+                                   |Use `-Dorg.gradle.java.home="C:\Program Files\Android\Android Studio\jbr` JBR |
| Emulator 10.0.2.2 not reachable     | `adb reverse tcp:3000 tcp:3000` and use `http://localhost:3000/ Settings |
| Room "column syncedAt` KSP         | duplicate old duplicate classes in same package → delete duplicate F5 earlier build #5 # earlier delete |
| state.fold ambiguous extension resolution            | use `BaseListActivity.bindState()` — wrap` already imports the correct `com.pos2013.offline.viewmodel.UiState.fold` once internally
| Login fails (because 201.3 offline capture "No value for x argument) | functions expression-body for `load()` → block-body. `override fun load() { vm.xxx(...) }. NOT `=  expression returning  Job expression return Job → Unit  |
