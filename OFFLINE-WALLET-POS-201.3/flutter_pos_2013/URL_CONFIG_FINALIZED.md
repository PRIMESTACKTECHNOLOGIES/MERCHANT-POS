# URL Configuration - FINALIZED

## ✅ Single Source of Truth

All URLs are now centralized in **`lib/core/config/url_config.dart`**

---

## 🔗 URL Configuration Summary

### Backend URL
| Environment | URL |
|-------------|-----|
| Production | `https://pos-offline-sftwr.onrender.com` |

### MyFatoorah URLs
| Environment | URL |
|-------------|-----|
| Test | `https://apitest.myfatoorah.com` |
| Live | `https://api.myfatoorah.com` |

### Webhook Endpoints (Backend receives these)
| Endpoint | URL |
|----------|-----|
| MyFatoorah Webhook | `https://pos-offline-sftwr.onrender.com/merchant/v1/myfatoorah/webhook` |

### Callback URLs (MyFatoorah redirects here)
| Type | URL |
|------|-----|
| Success | `https://pos-offline-sftwr.onrender.com/payment/success` |
| Error | `https://pos-offline-sftwr.onrender.com/payment/error` |

### API Endpoints
| Endpoint | Path |
|----------|------|
| Verify Terminal | `/merchant/v1/terminal/verify` |
| Offline Batch | `/merchant/v1/pos/201.3/offline-batch` |
| MyFatoorah Batch | `/merchant/v1/pos/201.3/myfatoorah-batch` |
| Redeem Payment | `/merchant/v1/payment/redeem` |
| Health Check | `/health` |

---

## 📁 Files Updated

### 1. **url_config.dart** (NEW)
- Centralized URL configuration
- Single source of truth for all URLs

### 2. **app_config.dart** (UPDATED)
- Now imports from `url_config.dart`
- `defaultServerUrl` → `UrlConfig.backendUrl`
- `myFatoorahTestUrl` → `UrlConfig.myFatoorahTestUrl`
- `myFatoorahLiveUrl` → `UrlConfig.myFatoorahLiveUrl`

### 3. **gateway_config.dart** (UPDATED)
- Now imports from `url_config.dart`
- `_defaultServerUrl` → `UrlConfig.backendUrl`
- `myFatoorahBaseUrl` now uses `UrlConfig` for test/live URLs

### 4. **setup_screen.dart** (UPDATED)
- Default server URL now from `UrlConfig.backendUrl`

### 5. **myfatoorah_model.dart** (UPDATED)
- Removed hardcoded `yourdomain.com` placeholders
- Callback URLs now set dynamically from repository

### 6. **myfatoorah_repository.dart** (UPDATED)
- Now imports from `url_config.dart`
- Sets `callBackUrl` and `errorUrl` from `UrlConfig`

### 7. **branding_config.dart** (UPDATED)
- Website URL updated to backend URL
- Support email updated

---

## 🔍 Verification Checklist

- [x] All URLs defined in `url_config.dart`
- [x] No hardcoded URLs in other files
- [x] Backend URL: `https://pos-offline-sftwr.onrender.com`
- [x] MyFatoorah test URL: `https://apitest.myfatoorah.com`
- [x] MyFatoorah live URL: `https://api.myfatoorah.com`
- [x] Webhook URL configured
- [x] Callback URLs configured

---

## 🚀 Usage

### Import the URL config:
```dart
import 'core/config/url_config.dart';
```

### Use the URLs:
```dart
// Backend URL
String backendUrl = UrlConfig.backendUrl;

// API URL
String apiUrl = UrlConfig.apiBaseUrl;

// MyFatoorah URLs
String mfTestUrl = UrlConfig.myFatoorahTestUrl;
String mfLiveUrl = UrlConfig.myFatoorahLiveUrl;

// Webhook URL
String webhookUrl = UrlConfig.myFatoorahWebhookUrl;

// Callback URLs
String callbackUrl = UrlConfig.myFatoorahCallbackUrl;
String errorUrl = UrlConfig.myFatoorahErrorUrl;
```

---

## 🔄 To Change URL (Future)

If you need to change the backend URL in the future, update ONLY this file:
```
lib/core/config/url_config.dart
```

Change line 9:
```dart
static const String backendUrl = 'https://your-new-url.com';
```

All other files will automatically use the new URL.

---

## ⚠️ Before Building

1. **Verify the URL in url_config.dart:**
   ```dart
   static const String backendUrl = 'https://pos-offline-sftwr.onrender.com';
   ```

2. **Configure MyFatoorah Webhook:**
   - Go to MyFatoorah dashboard
   - Set webhook URL: `https://pos-offline-sftwr.onrender.com/merchant/v1/myfatoorah/webhook`

3. **Build the app:**
   ```bash
   flutter build apk --release
   ```

---

## ✅ Final Status

**URL mismatch issue RESOLVED.**

All URLs are now:
- ✅ Centralized in one file
- ✅ Consistent across the entire app
- ✅ Using the correct backend: `pos-offline-sftwr.onrender.com`
