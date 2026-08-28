# Build APK Script for POS Android App
Write-Host "===================================" -ForegroundColor Green
Write-Host "POS Android App Builder" -ForegroundColor Green
Write-Host "===================================" -ForegroundColor Green
Write-Host ""

# Check if keystore exists
if (-not (Test-Path "pos-release-key.keystore")) {
    Write-Host "⚠️  Keystore not found. Creating new keystore..." -ForegroundColor Yellow
    
    # Create keystore with default password
    $keytool = "keytool"
    $keystoreCmd = "$keytool -genkey -v -keystore pos-release-key.keystore -alias pos-release-key -keyalg RSA -keysize 2048 -validity 10000 -storepass pos2013release -keypass pos2013release -dname 'CN=POS Merchant, OU=POS, O=POS Company, L=Dubai, C=AE'"
    
    Invoke-Expression $keystoreCmd
    
    # Create keystore.properties
    @"
storeFile=pos-release-key.keystore
storePassword=pos2013release
keyAlias=pos-release-key
keyPassword=pos2013release
"@ | Out-File -FilePath "keystore.properties" -Encoding UTF8
    
    Write-Host "✅ Keystore created successfully!" -ForegroundColor Green
} else {
    Write-Host "✅ Keystore found" -ForegroundColor Green
}

# Check if keystore.properties exists
if (-not (Test-Path "keystore.properties")) {
    Write-Host "⚠️  keystore.properties not found. Creating..." -ForegroundColor Yellow
    @"
storeFile=pos-release-key.keystore
storePassword=pos2013release
keyAlias=pos-release-key
keyPassword=pos2013release
"@ | Out-File -FilePath "keystore.properties" -Encoding UTF8
}

Write-Host ""
Write-Host "🔨 Building Release APK..." -ForegroundColor Cyan
Write-Host "This may take a few minutes..." -ForegroundColor Gray
Write-Host ""

# Build release APK
try {
    .\gradlew.bat assembleRelease
    
    Write-Host ""
    Write-Host "===================================" -ForegroundColor Green
    Write-Host "✅ BUILD SUCCESSFUL!" -ForegroundColor Green
    Write-Host "===================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "📱 APK Location:" -ForegroundColor Cyan
    Write-Host "app/build/outputs/apk/release/app-release.apk" -ForegroundColor White
    Write-Host ""
    Write-Host "📋 Next Steps:" -ForegroundColor Yellow
    Write-Host "1. Copy APK to your Android device" -ForegroundColor White
    Write-Host "2. Install and open the app" -ForegroundColor White
    Write-Host "3. Enter Server URL: https://pos-201-3-offline-6-digit-1.onrender.com" -ForegroundColor White
    Write-Host "4. Complete terminal registration" -ForegroundColor White
    Write-Host ""
    
    # Copy APK to desktop for easy access
    $apkSource = "app/build/outputs/apk/release/app-release.apk"
    $apkDest = "..\POS-App-Release.apk"
    
    if (Test-Path $apkSource) {
        Copy-Item $apkSource $apkDest -Force
        Write-Host "📦 APK copied to: POS-App-Release.apk" -ForegroundColor Green
    }
} catch {
    Write-Host ""
    Write-Host "❌ BUILD FAILED" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Try running with: .\gradlew.bat assembleRelease --info" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Press any key to exit..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
