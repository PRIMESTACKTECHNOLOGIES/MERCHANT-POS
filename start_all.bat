@echo off
SETLOCAL EnableExtensions EnableDelayedExpansion

rem ============================================================
rem  PRIMESTACK POS 201.3 — ONE-CLICK LAUNCHER
rem  Protocols : 101.1 (Voice Auth) | 101.6 (EMV/NFC) | 201.3 (Online POS)
rem  NFC       : ACR122U USB reader + Android built-in NFC
rem  Live site : https://merchantpos.netlify.app
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
set "NETLIFY_URL=https://merchantpos.netlify.app"

REM ── Vault Bank Receiving Accounts (blank until a new bank is configured) ──
set "VAULT_USD_ACCOUNT="
set "VAULT_USD_ROUTING="
set "VAULT_USD_SWIFT="
set "VAULT_EUR_IBAN="
set "VAULT_EUR_BIC="
set "VAULT_AED_IBAN="
set "VAULT_AED_SWIFT="
set "ACCOUNT_HOLDER="

title PRIMESTACK POS 201.3 — Launcher

cls
echo.
echo ================================================================
echo   PRIMESTACK POS 201.3 — SYSTEM LAUNCHER
echo ================================================================
echo.
echo   Live Site       : %NETLIFY_URL%
echo   Live Backend    : %RENDER_URL%
echo   Local Backend   : http://localhost:%BACKEND_PORT%
echo   Local POS       : http://localhost:%POS_FRONTEND_PORT%/overview
echo   Local Vault     : http://localhost:%VAULT_FRONTEND_PORT%/vault-bank
echo   Vault Service   : http://127.0.0.1:%VAULT_BANK_PORT%/health
echo.
echo ================================================================
echo   VAULT BANK RECEIVING ACCOUNTS
echo ================================================================
echo.
echo   USD  Account    : %VAULT_USD_ACCOUNT%
echo   USD  Routing    : %VAULT_USD_ROUTING%
echo   USD  SWIFT      : %VAULT_USD_SWIFT%
echo.
echo   EUR  IBAN       : %VAULT_EUR_IBAN%
echo   EUR  BIC        : %VAULT_EUR_BIC%
echo.
echo   AED  IBAN       : %VAULT_AED_IBAN%
echo   AED  SWIFT      : %VAULT_AED_SWIFT%
echo.
echo   Account Holder  : %ACCOUNT_HOLDER%
echo.
echo ================================================================
echo.

REM ── Step 1: Start PC/SC service for ACR122U NFC reader ───────────────────
echo [NFC] Checking PC/SC Smart Card service (required for ACR122U)...
sc query SCardSvr | findstr "RUNNING" >nul 2>&1
if errorlevel 1 (
    echo [NFC] Starting PC/SC service...
    net start SCardSvr >nul 2>&1
    if errorlevel 1 (
        echo [NFC] WARNING: Could not start SCardSvr. Run as Administrator for ACR122U support.
    ) else (
        echo [NFC] PC/SC service started. ACR122U will be detected automatically.
    )
) else (
    echo [NFC] PC/SC service running. ACR122U ready.
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

REM ── Step 3: Check Node.js ────────────────────────────────────────────────
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)
for /f %%v in ('node --version') do set "NODE_VER=%%v"
echo [INFO] Node.js %NODE_VER% found.
echo.

REM ── Step 4: Install dependencies if missing ──────────────────────────────
if not exist "%BACKEND_DIR%\node_modules" (
    echo [1/4] Installing backend dependencies...
    cd /d "%BACKEND_DIR%"
    call npm install --silent
    if errorlevel 1 ( echo [ERROR] Backend npm install failed. & pause & exit /b 1 )
    echo [OK] Backend dependencies installed.
) else (
    echo [1/4] Backend dependencies OK [SKIP]
)

if not exist "%FRONTEND_DIR%\node_modules" (
    echo [2/4] Installing frontend dependencies...
    cd /d "%FRONTEND_DIR%"
    call npm install --silent
    if errorlevel 1 ( echo [ERROR] Frontend npm install failed. & pause & exit /b 1 )
    echo [OK] Frontend dependencies installed.
) else (
    echo [2/4] Frontend dependencies OK [SKIP]
)
echo.

cd /d "%PROJECT_ROOT%"

REM ── Step 5: Build backend if dist missing ────────────────────────────────
if not exist "%BACKEND_DIR%\dist\server.js" (
    echo [BUILD] dist\server.js not found. Building backend...
    cd /d "%BACKEND_DIR%"
    call npm run build
    if errorlevel 1 ( echo [ERROR] Build failed. & pause & exit /b 1 )
    echo [OK] Backend built.
    echo.
)

REM ── Step 6: Start backend (compiled dist — fast startup) ─────────────────
echo [3/4] Starting backend on port %BACKEND_PORT%...
start "POS Backend :7000" cmd /k "title POS Backend :7000 && cd /d ""%BACKEND_DIR%"" && echo. && echo  *** PRIMESTACK POS BACKEND *** && echo  API      : http://localhost:%BACKEND_PORT% && echo  Health   : http://localhost:%BACKEND_PORT%/health && echo  ACR122U  : http://localhost:%BACKEND_PORT%/merchant/v1/payments/read-acr122u/status && echo  Database : %DATABASE_FILE% && echo. && npm start"

echo [3b/4] Starting vault-bank settlement service on port %VAULT_BANK_PORT%...
start "Vault Bank :9001" cmd /k "title Vault Bank :9001 && cd /d ""%BACKEND_DIR%"" && echo. && echo  *** VAULT BANK SETTLEMENT SERVICE *** && echo  Health : http://127.0.0.1:%VAULT_BANK_PORT%/health && echo. && node vault-bank-settlement.js"

REM ── Wait for backend health ───────────────────────────────────────────────
echo [INFO] Waiting for backend (max 60s)...
set "BACKEND_READY="
for /l %%I in (1,1,60) do (
    curl.exe --silent --fail http://localhost:%BACKEND_PORT%/health >nul 2>&1
    if not errorlevel 1 ( set "BACKEND_READY=1" & goto :backend_ok )
    timeout /t 1 /nobreak >nul
)
:backend_ok
if not defined BACKEND_READY (
    echo [WARNING] Backend did not start in 60s. Check the Backend window.
) else (
    echo [OK] Backend live at http://localhost:%BACKEND_PORT%
)
echo.

REM ── Step 7: Start frontends ───────────────────────────────────────────────
echo [4/4] Starting POS dashboard on port %POS_FRONTEND_PORT%...
start "POS Dashboard :7001" cmd /k "title POS Dashboard :7001 && cd /d ""%FRONTEND_DIR%"" && echo. && echo  *** POS DASHBOARD *** && echo  URL : http://localhost:%POS_FRONTEND_PORT%/overview && echo. && set VITE_APP_MODE=pos && set VITE_API_URL=http://127.0.0.1:%BACKEND_PORT% && call npm run dev -- --host 0.0.0.0 --port %POS_FRONTEND_PORT%"

echo [4b/4] Starting Vault Bank dashboard on port %VAULT_FRONTEND_PORT%...
start "Vault Dashboard :7002" cmd /k "title Vault Dashboard :7002 && cd /d ""%FRONTEND_DIR%"" && echo. && echo  *** VAULT BANK DASHBOARD *** && echo  URL : http://localhost:%VAULT_FRONTEND_PORT%/vault-bank && echo. && set VITE_APP_MODE=vault-bank && set VITE_API_URL=http://127.0.0.1:%BACKEND_PORT% && call npm run dev -- --host 0.0.0.0 --port %VAULT_FRONTEND_PORT%"

REM ── Wait for POS frontend ─────────────────────────────────────────────────
echo [INFO] Waiting for POS dashboard (max 60s)...
set "FRONTEND_READY="
for /l %%I in (1,1,60) do (
    curl.exe --silent --fail http://localhost:%POS_FRONTEND_PORT% >nul 2>&1
    if not errorlevel 1 ( set "FRONTEND_READY=1" & goto :frontend_ok )
    timeout /t 1 /nobreak >nul
)
:frontend_ok
if not defined FRONTEND_READY (
    echo [WARNING] POS dashboard did not start in 60s. Check the Dashboard window.
) else (
    echo [OK] POS Dashboard live at http://localhost:%POS_FRONTEND_PORT%/overview
)
echo.

REM ── Check ACR122U ────────────────────────────────────────────────────────
echo [NFC] Checking ACR122U USB card reader...
curl.exe --silent http://localhost:%BACKEND_PORT%/merchant/v1/payments/read-acr122u/status 2>nul | findstr "connected" >nul 2>&1
if errorlevel 1 (
    echo [NFC] ACR122U: Not connected. Plug in USB reader to enable contactless payments.
) else (
    echo [NFC] ACR122U: CONNECTED and ready for card taps!
)
echo.

REM ── Auto-open POS dashboard in browser ───────────────────────────────────
if defined FRONTEND_READY (
    echo [INFO] Opening POS dashboard in browser...
    start "" "http://localhost:%POS_FRONTEND_PORT%/overview"
    timeout /t 2 /nobreak >nul
)

REM ── Final summary ─────────────────────────────────────────────────────────
echo.
echo ================================================================
echo   PRIMESTACK POS 201.3 — ALL SYSTEMS RUNNING
echo ================================================================
echo.
echo   LOCAL SERVICES
echo   --------------
echo   POS Dashboard   : http://localhost:%POS_FRONTEND_PORT%/overview
echo   Vault Dashboard : http://localhost:%VAULT_FRONTEND_PORT%/vault-bank
echo   Backend API     : http://localhost:%BACKEND_PORT%
echo   Vault Service   : http://127.0.0.1:%VAULT_BANK_PORT%/health
echo   ACR122U NFC     : http://localhost:%BACKEND_PORT%/merchant/v1/payments/read-acr122u/status
echo.
echo   REMOTE (LIVE)
echo   -------------
echo   Live Backend    : %RENDER_URL%
echo   Live Frontend   : %NETLIFY_URL%
echo.
echo   CARD READING
echo   ------------
echo   ACR122U USB     : Tap card on reader (local backend)
echo   Android NFC     : Tap card on phone  (Render backend)
echo   Protocols       : 101.1 Voice Auth / 101.6 EMV+NFC / 201.3 Online POS
echo.
echo   VAULT BANK ACCOUNTS (for receiving funds)
echo   ------------------------------------------
echo   USD Account     : %VAULT_USD_ACCOUNT%  Routing: %VAULT_USD_ROUTING%
echo   EUR IBAN        : %VAULT_EUR_IBAN%
echo   AED IBAN        : %VAULT_AED_IBAN%
echo   Account Holder  : %ACCOUNT_HOLDER%
echo.
echo   LOGIN CREDENTIALS
echo   -----------------
echo   Username        : admin
echo   Password        : admin123
echo.
echo   DATABASE
echo   --------
echo   Local DB        : %DATABASE_FILE%
echo   Remote DB       : /data/database.sqlite (Render persistent disk)
echo.
echo ================================================================
echo   Keep all console windows open while using the system.
echo   This window can be closed - services keep running.
echo ================================================================
echo.
timeout /t 10 /nobreak >nul
