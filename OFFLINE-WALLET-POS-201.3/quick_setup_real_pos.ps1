# Quick Setup Script for Real Transaction POS System
# Run this script to initialize everything automatically

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "   POS OFFLINE - REAL TRANSACTION SETUP" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check if backend is running
Write-Host "[1/4] Checking backend server..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 2 -ErrorAction Stop
    Write-Host "Backend server is already running" -ForegroundColor Green
} catch {
    Write-Host "Backend not running. Starting now..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot'; npm run dev"
    Write-Host "Waiting 5 seconds for server to start..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
}

# Step 2: Initialize database
Write-Host ""
Write-Host "[2/4] Initializing database..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\backend"
try {
    npx ts-node init_2013_db.ts
    Write-Host "Database initialized successfully!" -ForegroundColor Green
} catch {
    Write-Host "Database initialization failed: $_" -ForegroundColor Red
    exit 1
}

# Step 3: Get PC's IP address
Write-Host ""
Write-Host "[3/4] Finding your PC's IP address..." -ForegroundColor Yellow
$ip = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" } | Select-Object -First 1 -ExpandProperty IPAddress
Write-Host "Your PC's IP address: $ip" -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT: Copy this IP address!" -ForegroundColor Cyan
Write-Host "You will need it in Step 4" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press any key to continue..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Step 4: Open Android Studio instructions
Write-Host ""
Write-Host "[4/4] Android Studio Setup" -ForegroundColor Yellow
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Open Android Studio" -ForegroundColor White
Write-Host "2. File - Open - Select: android_pos_app folder" -ForegroundColor White
Write-Host "3. Navigate to: app/src/main/java/com/pos2013/offline/data/api/PosApi.kt" -ForegroundColor White
Write-Host "4. Change line 40 from:" -ForegroundColor White
Write-Host "   private const val DEFAULT_BASE_URL = `"http://192.168.1.160:3000/`"" -ForegroundColor Yellow
Write-Host "   TO:" -ForegroundColor White
Write-Host "   private const val DEFAULT_BASE_URL = `"http://$ip`:3000/`"" -ForegroundColor Green
Write-Host "5. Save file (Ctrl+S)" -ForegroundColor White
Write-Host "6. Build - Build APK" -ForegroundColor White
Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Backend is running on: http://localhost:3000" -ForegroundColor Green
Write-Host "Dashboard available at: http://localhost:5173" -ForegroundColor Green
Write-Host ""
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Press any key to open browser dashboard..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Open dashboard
Start-Process "http://localhost:5173"

Write-Host ""
Write-Host "All set! Check your phone for the app installation." -ForegroundColor Green
Write-Host ""
