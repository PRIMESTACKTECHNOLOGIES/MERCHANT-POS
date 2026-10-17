@echo off
SETLOCAL EnableExtensions EnableDelayedExpansion

rem ============================================================
rem  PRIMESTACK POS 201.3 — ONE-CLICK LAUNCHER
rem  Supports:
rem    - Local backend (port 7000)
rem    - POS dashboard (port 7001)
rem    - Vault Bank dashboard (port 7002)
rem    - ACR122U NFC card reader (PC/SC)
rem    - Android NFC (via Render backend)
rem ============================================================

set "PROJECT_ROOT=%~dp0"
if exist "%~dp0OFFLINE-WALLET-POS-201.3\backend" if not exist "%~dp0backend" (
    set "PROJECT_ROOT=%~dp0OFFLINE-WALLET-POS-201.3"
)

cd /d "%PROJECT_ROOT%"

set "BACKEND_PORT=7000"
set "VAULT_BANK_PORT=9001"
set "POS_FRONTEND_PORT=7001"
set "VAULT_FRONTEND_PORT=7002"
set "BACKEND_DIR=%PROJECT_ROOT%backend"
set "FRONTEND_DIR=%PROJECT_ROOT%client"
set "DATABASE_FILE=%PROJECT_ROOT%backend\data\database.sqlite"
set "RENDER_URL=https://merchant-pos-0nno.onrender.com"

title PRIMESTACK POS 201.3 — Launcher

cls
echo.
echo ============================================================
echo   PRIMESTACK POS 201.3 SYSTEM LAUNCHER
echo ============================================================
echo.
echo   Local Backend     : http://localhost:%BACKEND_PORT%
echo   POS Dashboard     : http://localhost:%POS_FRONTEND_PORT%/overview
echo   Vault Dashboard   : http://localhost:%VAULT_FRONTEND_PORT%/vault-bank
echo   Vault API         : http://127.0.0.1:%VAULT_BANK_PORT%/health
echo   Remote (Render)   : %RENDER_URL%
echo   Frontend (Live)   : https://merchantpos.netlify.app
echo.
echo ============================================================
echo.

REM ── Step 1: Start PC/SC service for ACR122U NFC reader ───────────────────
echo [NFC] Checking PC/SC Smart Card service (required for ACR122U)...
sc query SCardSvr | findstr "RUNNING" >nul 2>&1
if errorlevel 1 (
    echo [NFC] PC/SC service not running. Starting it now...
    net start SCardSvr >nul 2>&1
    if errorlevel 1 (
        echo [NFC] WARNING: Could not start SCardSvr. ACR122U may not work.
        echo [NFC] To fix: Run this launcher as Administrator.
    ) else (
        echo [NFC] PC/SC service started.
    )
) else (
    echo [NFC] PC/SC service is running. ACR122U reader will be detected automatically.
)
echo.

REM ── Step 2: Kill any existing processes on used ports ────────────────────
echo [INFO] Clearing ports %BACKEND_PORT%, %POS_FRONTEND_PORT%, %VAULT_FRONTEND_PORT%, %VAULT_BANK_PORT%...
for %%P in (%BACKEND_PORT% %POS_FRONTEND_PORT% %VAULT_FRONTEND_PORT% %VAULT_BANK_PORT%) do (
    for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%%P.*LISTENING" 2^>nul') do (
        taskkill /PID %%a /F >nul 2>&1
    )
)
ping -n 2 127.0.0.1 >nul
echo [OK] Ports cleared.
echo.

REM ── Step 3: Check Node.js ─────────────────────────────────────────────────
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)
echo [INFO] Node.js: & node --version
echo.

REM ── Step 4: Install backend dependencies if missing ──────────────────────
if not exist "%BACKEND_DIR%\node_modules" (
    echo [1/4] Installing backend dependencies...
    cd /d "%BACKEND_DIR%"
    call npm install
    if errorlevel 1 (
        echo [ERROR] Backend npm install failed.
        pause
        exit /b 1
    )
    echo [OK] Backend dependencies installed.
) else (
    echo [1/4] Backend dependencies OK [SKIP]
)
echo.

REM ── Step 5: Install frontend dependencies if missing ─────────────────────
if not exist "%FRONTEND_DIR%\node_modules" (
    echo [2/4] Installing frontend dependencies...
    cd /d "%FRONTEND_DIR%"
    call npm install
    if errorlevel 1 (
        echo [ERROR] Frontend npm install failed.
        pause
        exit /b 1
    )
    echo [OK] Frontend dependencies installed.
) else (
    echo [2/4] Frontend dependencies OK [SKIP]
)
echo.

cd /d "%PROJECT_ROOT%"

REM ── Step 6: Start backend ─────────────────────────────────────────────────
echo [3/4] Starting local backend on port %BACKEND_PORT%...
start "POS Backend :7000" cmd /k "title POS Backend :7000 && cd /d ""%BACKEND_DIR%"" && echo. && echo  Backend: http://localhost:%BACKEND_PORT% && echo  ACR122U NFC: http://localhost:%BACKEND_PORT%/merchant/v1/payments/read-acr122u/status && echo  Database: %DATABASE_FILE% && echo. && npm run dev"

echo [3b/4] Starting vault-bank service on port %VAULT_BANK_PORT%...
start "Vault Bank :9001" cmd /k "title Vault Bank :9001 && cd /d ""%BACKEND_DIR%"" && echo. && echo  Vault Bank: http://127.0.0.1:%VAULT_BANK_PORT% && echo. && npm run dev:vault-bank"

REM Wait for backend to be ready
echo [INFO] Waiting for backend to start (health check)...
set "BACKEND_READY="
for /l %%I in (1,1,60) do (
    curl.exe --silent --fail http://localhost:%BACKEND_PORT%/health >nul 2>&1
    if not errorlevel 1 (
        set "BACKEND_READY=1"
        goto :backend_ok
    )
    timeout /t 1 /nobreak >nul
)
:backend_ok
if not defined BACKEND_READY (
    echo [WARNING] Backend health check timed out. Check the Backend window for errors.
) else (
    echo [OK] Backend is live at http://localhost:%BACKEND_PORT%
)
echo.

REM ── Step 7: Start POS dashboard ───────────────────────────────────────────
echo [4/4] Starting POS dashboard on port %POS_FRONTEND_PORT%...
start "POS Dashboard :7001" cmd /k "title POS Dashboard :7001 && cd /d ""%FRONTEND_DIR%"" && echo. && echo  POS Dashboard: http://localhost:%POS_FRONTEND_PORT%/overview && echo. && set VITE_APP_MODE=pos && set VITE_API_URL=http://127.0.0.1:%BACKEND_PORT% && call npm run dev -- --host 0.0.0.0 --port %POS_FRONTEND_PORT%"

echo [4b/4] Starting Vault Bank dashboard on port %VAULT_FRONTEND_PORT%...
start "Vault Dashboard :7002" cmd /k "title Vault Dashboard :7002 && cd /d ""%FRONTEND_DIR%"" && echo. && echo  Vault Dashboard: http://localhost:%VAULT_FRONTEND_PORT%/vault-bank && echo. && set VITE_APP_MODE=vault-bank && set VITE_API_URL=http://127.0.0.1:%BACKEND_PORT% && call npm run dev -- --host 0.0.0.0 --port %VAULT_FRONTEND_PORT%"

REM Wait for frontend
echo [INFO] Waiting for POS dashboard...
set "FRONTEND_READY="
for /l %%I in (1,1,60) do (
    curl.exe --silent --fail http://localhost:%POS_FRONTEND_PORT% >nul 2>&1
    if not errorlevel 1 (
        set "FRONTEND_READY=1"
        goto :frontend_ok
    )
    timeout /t 1 /nobreak >nul
)
:frontend_ok
if not defined FRONTEND_READY (
    echo [WARNING] Frontend health check timed out. Check the Dashboard window for errors.
) else (
    echo [OK] POS Dashboard live at http://localhost:%POS_FRONTEND_PORT%/overview
)
echo.

REM ── Check ACR122U status ──────────────────────────────────────────────────
echo [NFC] Checking ACR122U reader status...
curl.exe --silent http://localhost:%BACKEND_PORT%/merchant/v1/payments/read-acr122u/status 2>nul | findstr "connected" >nul 2>&1
if errorlevel 1 (
    echo [NFC] ACR122U: Not detected — plug in the USB reader to enable contactless payments.
) else (
    echo [NFC] ACR122U: CONNECTED and ready for card taps.
)
echo.

REM ── Final summary ─────────────────────────────────────────────────────────
echo.
echo ============================================================
echo   PRIMESTACK POS 201.3 — SYSTEM RUNNING
echo ============================================================
echo.
echo   LOCAL URLS
echo   ----------
echo   POS Dashboard   : http://localhost:%POS_FRONTEND_PORT%/overview
echo   Vault Dashboard : http://localhost:%VAULT_FRONTEND_PORT%/vault-bank
echo   Backend API     : http://localhost:%BACKEND_PORT%
echo   Vault Service   : http://127.0.0.1:%VAULT_BANK_PORT%/health
echo   ACR122U NFC     : http://localhost:%BACKEND_PORT%/merchant/v1/payments/read-acr122u/status
echo.
echo   REMOTE URLS
echo   -----------
echo   Live Backend    : %RENDER_URL%
echo   Live Frontend   : https://merchantpos.netlify.app
echo.
echo   CARD READING
echo   ------------
echo   Android NFC     : Tap card on Android device (uses Render backend)
echo   ACR122U Reader  : Tap card on USB reader (uses local backend)
echo   Protocol        : 101.6 (EMV Chip/NFC) / 101.1 (Voice Auth) / 201.3 (Online POS)
echo.
echo   DATABASE
echo   --------
echo   Local DB        : %DATABASE_FILE%
echo   Remote DB       : /data/database.sqlite (on Render disk)
echo.
echo ============================================================
echo   Keep all console windows open while using the system.
echo   Press any key to minimize this launcher.
echo ============================================================
echo.
pause >nul

echo Launcher minimized. System is still running in background windows.
