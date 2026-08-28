# POS-201.3 Flutter App Bundle Build Script
# For Google Play Store submission

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  POS-201.3 App Bundle Build" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Step 1: Cleaning previous builds..." -ForegroundColor Yellow
flutter clean

Write-Host ""
Write-Host "Step 2: Getting dependencies..." -ForegroundColor Yellow
flutter pub get

Write-Host ""
Write-Host "Step 3: Building App Bundle..." -ForegroundColor Yellow
flutter build appbundle --release

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  BUILD SUCCESSFUL!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "App Bundle Location:" -ForegroundColor Cyan
    Write-Host "  build\app\outputs\bundle\release\app-release.aab" -ForegroundColor White
    Write-Host ""
    Write-Host "Upload this file to Google Play Console" -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  BUILD FAILED!" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    exit 1
}
