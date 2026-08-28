# Build Android POS App - RELEASE Build Script
# Builds a SIGNED release APK for production use
# Requires environment variables: POS_KEYSTORE_PATH, POS_KEYSTORE_PASSWORD, POS_KEY_ALIAS, POS_KEY_PASSWORD

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "Android POS App - RELEASE APK Builder" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "🔐 Building SIGNED RELEASE APK for Live POS Transactions" -ForegroundColor Cyan
Write-Host "   Protocol 201.3 - Production Ready" -ForegroundColor Cyan
Write-Host ""

$projectPath = Join-Path $PSScriptRoot "android_pos_app"

if (!(Test-Path $projectPath)) {
    Write-Host "❌ Error: android_pos_app folder not found!" -ForegroundColor Red
    Write-Host "Please make sure you're running this from the main project folder." -ForegroundColor Yellow
    exit 1
}

Write-Host "📁 Project Path: $projectPath" -ForegroundColor Green
Write-Host ""

# Check if gradlew exists
$gradlewPath = Join-Path $projectPath "gradlew.bat"

if (!(Test-Path $gradlewPath)) {
    Write-Host "⚠️  Gradle wrapper not found. Creating..." -ForegroundColor Yellow
    
    # Try to use system gradle
    try {
        & gradle --version | Out-Null
        Write-Host "✓ System Gradle found" -ForegroundColor Green
        
        Set-Location $projectPath
        gradle wrapper
        Write-Host "✓ Gradle wrapper created" -ForegroundColor Green
    } catch {
        Write-Host "❌ Gradle not found. Please install Android Studio or Gradle first." -ForegroundColor Red
        Write-Host ""
        Write-Host "Alternative: Open android_pos_app in Android Studio and click Build → Build APK" -ForegroundColor Yellow
        exit 1
    }
}

Write-Host ""
Write-Host "🔐 Building SIGNED RELEASE APK..." -ForegroundColor Cyan
Set-Location $projectPath

# Check for required environment variables
$requiredVars = @("POS_KEYSTORE_PATH", "POS_KEYSTORE_PASSWORD", "POS_KEY_ALIAS", "POS_KEY_PASSWORD")
$missingVars = @()

foreach ($var in $requiredVars) {
    if (!(Test-Path Env:\$var)) {
        $missingVars += $var
    }
}

if ($missingVars.Count -gt 0) {
    Write-Host ""
    Write-Host "⚠️  WARNING: Missing environment variables!" -ForegroundColor Yellow
    Write-Host "   The build will fail unless signing is configured." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Missing variables:" -ForegroundColor Yellow
    foreach ($var in $missingVars) {
        Write-Host "  - $var" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "To set these (run once as Administrator):" -ForegroundColor Cyan
    Write-Host '[System.Environment]::SetEnvironmentVariable("POS_KEYSTORE_PATH", "C:\path\to\keystore.jks", "User")' -ForegroundColor Gray
    Write-Host '[System.Environment]::SetEnvironmentVariable("POS_KEYSTORE_PASSWORD", "your_password", "User")' -ForegroundColor Gray
    Write-Host '[System.Environment]::SetEnvironmentVariable("POS_KEY_ALIAS", "your_alias", "User")' -ForegroundColor Gray
    Write-Host '[System.Environment]::SetEnvironmentVariable("POS_KEY_PASSWORD", "your_key_password", "User")' -ForegroundColor Gray
    Write-Host ""
    
    $continue = Read-Host "Continue anyway? (Build might fail) (y/n)"
    if ($continue -ne 'y' -and $continue -ne 'Y') {
        Write-Host "Build cancelled. Please configure environment variables first." -ForegroundColor Yellow
        Set-Location $PSScriptRoot
        exit 0
    }
}

try {
    # Build release APK with signing
    & .\gradlew.bat assembleRelease
    
    Write-Host ""
    Write-Host "✅ Release Build Complete!" -ForegroundColor Green
    Write-Host ""
    
    $apkPath = Join-Path $projectPath "app\build\outputs\apk\release\app-release.apk"
    
    if (Test-Path $apkPath) {
        Write-Host "📱 RELEASE APK Location:" -ForegroundColor Cyan
        Write-Host "$apkPath" -ForegroundColor White
        Write-Host ""
        Write-Host "📋 Next Steps:" -ForegroundColor Yellow
        Write-Host "1. ✅ This is a SIGNED release build (if env vars configured)" -ForegroundColor White
        Write-Host "2. Transfer this RELEASE APK to your POS device" -ForegroundColor White
        Write-Host "3. On device: enable installation from unknown sources" -ForegroundColor White
        Write-Host "4. Install the APK" -ForegroundColor White
        Write-Host "5. Open POS 201.3 app" -ForegroundColor White
        Write-Host "6. Run your live/offline transaction tests" -ForegroundColor White
        Write-Host ""
        Write-Host "🔒 Security Features Enabled:" -ForegroundColor Cyan
        Write-Host "  ✓ debuggable = false (cannot be debugged)" -ForegroundColor Green
        Write-Host "  ✓ ProGuard obfuscation (code protected)" -ForegroundColor Green
        Write-Host "  ✓ Signed with your keystore (authenticated)" -ForegroundColor Green
        Write-Host "  ✓ Optimized for production" -ForegroundColor Green
        Write-Host ""
        
        # Ask if user wants to open folder
        $openExplorer = Read-Host "Open folder containing RELEASE APK? (y/n)"
        if ($openExplorer -eq 'y' -or $openExplorer -eq 'Y') {
            explorer "/select,$apkPath"
        }
    } else {
        Write-Host "❌ RELEASE APK file not found at expected location!" -ForegroundColor Red
        Write-Host "Check build output for signing or build errors." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Troubleshooting:" -ForegroundColor Cyan
        Write-Host "  1. Check if environment variables are set correctly" -ForegroundColor White
        Write-Host "  2. Verify keystore file exists at POS_KEYSTORE_PATH" -ForegroundColor White
        Write-Host "  3. Check app/build.gradle.kts has signingConfigs" -ForegroundColor White
        Write-Host "  4. Look for detailed errors in Gradle output above" -ForegroundColor White
    }
} catch {
    Write-Host ""
    Write-Host "❌ Build failed!" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Try building manually in Android Studio:" -ForegroundColor Yellow
    Write-Host "1. Open android_pos_app folder in Android Studio" -ForegroundColor White
    Write-Host "2. Click Build → Build Bundle(s) / APK(s) → Build APK(s)" -ForegroundColor White
}

Set-Location $PSScriptRoot
Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "Script finished" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
