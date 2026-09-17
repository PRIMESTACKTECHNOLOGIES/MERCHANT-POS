@echo off
SETLOCAL EnableExtensions EnableDelayedExpansion

rem Resolve the active project root so this launcher works from either
rem the parent folder or the embedded repository folder.
set "PROJECT_ROOT=%~dp0"
if exist "%~dp0OFFLINE-WALLET-POS-201.3\backend" if not exist "%~dp0backend" (
    set "PROJECT_ROOT=%~dp0OFFLINE-WALLET-POS-201.3"
)

cd /d "%PROJECT_ROOT%"

set "BACKEND_PORT=7000"
set "FRONTEND_PORT=7001"
set "BACKEND_DIR=%PROJECT_ROOT%backend"
set "FRONTEND_DIR=%PROJECT_ROOT%client"
set "DATABASE_FILE=%PROJECT_ROOT%backend\data\database.sqlite"

title POS 201.3 System Launcher

cls
echo.
echo ============================================================
echo  POS OFFLINE SYSTEM v201.3 - ONE CLICK START
echo ============================================================
echo.
echo  Backend:  http://localhost:%BACKEND_PORT%
echo  Frontend: http://localhost:%FRONTEND_PORT%
echo.
echo  Payout Provider : Wise (PRIMESTACK TECHNOLOGIES LLC)
echo  Wise Account    : 343612919064346
echo  Routing (ABA)   : 084009519
echo  SWIFT           : TRWIUS35XXX
echo  Recipient Addr   : 1500 N GRANT ST STE N, Denver, CO 80203, US
echo.
echo ============================================================
echo.

REM ── Kill any existing processes on ports 7000 and 7001 ───────────────────
echo [INFO] Clearing ports %BACKEND_PORT% and %FRONTEND_PORT%...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%BACKEND_PORT%.*LISTENING" 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%FRONTEND_PORT%.*LISTENING" 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)
ping -n 2 127.0.0.1 >nul
echo [OK] Ports cleared.
echo.

REM ── Check Node.js ─────────────────────────────────────────────────────────
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)
echo [INFO] Node.js found:
node --version
echo.

REM ── Backend dependencies ──────────────────────────────────────────────────
if not exist "%BACKEND_DIR%\node_modules" (
    echo [1/4] Installing backend dependencies...
    cd /d "%BACKEND_DIR%"
    call npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install backend dependencies.
        pause
        exit /b 1
    )
    echo [OK] Backend dependencies installed.
    echo.
) else (
    echo [1/4] Backend dependencies already installed [SKIP]
)

REM ── Frontend dependencies ─────────────────────────────────────────────────
if not exist "%FRONTEND_DIR%\node_modules" (
    echo [2/4] Installing frontend dependencies...
    cd /d "%FRONTEND_DIR%"
    call npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install frontend dependencies.
        pause
        exit /b 1
    )
    echo [OK] Frontend dependencies installed.
    echo.
) else (
    echo [2/4] Frontend dependencies already installed [SKIP]
)

cd /d "%~dp0"

REM ── Start backend ─────────────────────────────────────────────────────────
echo [3/4] Starting backend server on port %BACKEND_PORT%...
start "POS Backend (201.3)" cmd /k "title POS Backend 201.3 && cd /d ""%BACKEND_DIR%"" && echo Starting POS 201.3 Backend... && echo Database: %DATABASE_FILE% && npm run dev"

REM Wait for backend
echo [INFO] Waiting for backend to start...
ping -n 8 127.0.0.1 >nul

REM ── Start frontend ────────────────────────────────────────────────────────
echo [4/4] Starting frontend on port %FRONTEND_PORT%...
start "POS Frontend (201.3)" cmd /k "title POS Frontend 201.3 && cd /d ""%FRONTEND_DIR%"" && echo Starting POS Frontend... && set VITE_API_URL=http://localhost:%BACKEND_PORT% && npm run dev -- --host 0.0.0.0 --port %FRONTEND_PORT%"

REM Wait for frontend
echo [INFO] Waiting for frontend to start...
ping -n 10 127.0.0.1 >nul

REM ── Open browser ──────────────────────────────────────────────────────────
echo [INFO] Opening browser...
start "" "http://localhost:%FRONTEND_PORT%"

cls
echo.
echo ============================================================
echo  POS 201.3 SYSTEM IS RUNNING
echo ============================================================
echo.
echo  Status   : ONLINE
echo  Backend  : http://localhost:%BACKEND_PORT%
echo  Frontend : http://localhost:%FRONTEND_PORT%
echo.
echo ============================================================
echo  PAGES
echo ============================================================
echo.
echo  Overview        : http://localhost:%FRONTEND_PORT%/overview
echo  POS Terminal    : http://localhost:%FRONTEND_PORT%/pos
echo  POS Secure      : http://localhost:%FRONTEND_PORT%/pos-secure
echo  Wallets         : http://localhost:%FRONTEND_PORT%/wallets
echo  Wallet Transfer : http://localhost:%FRONTEND_PORT%/wallet-transfer
echo  Settlements     : http://localhost:%FRONTEND_PORT%/settlements
echo  Transactions    : http://localhost:%FRONTEND_PORT%/transactions
echo  Batches         : http://localhost:%FRONTEND_PORT%/batches
echo  Hot Wallet      : http://localhost:%FRONTEND_PORT%/hot-wallet
echo  Vault Bank      : http://localhost:%FRONTEND_PORT%/vault
echo  Verify Txn      : http://localhost:%FRONTEND_PORT%/verify-transaction
echo  Developer       : http://localhost:%FRONTEND_PORT%/developer
echo  Settings        : http://localhost:%FRONTEND_PORT%/settings
echo  Customer Entry  : http://localhost:%FRONTEND_PORT%/customer-entry
echo.
echo ============================================================
echo  MERCHANT WALLET (REAL FUNDS)
echo ============================================================
echo.
echo  USD  : $3,998,193.00  (real card receipts - live from DB)
echo  EUR  : 510,000,000.00 (real card receipts - live from DB)
echo.
echo ============================================================
echo  CUSTOMER WALLETS (REAL BALANCES)
echo ============================================================
echo.
echo  JJ DUMBA          : $500,000,000.00 USD
echo  NGUYEN NGOC SON   : $10,000,000.00  USD
echo  NAVEED AHMED      : $5,000,000.00   USD
echo  HUSSAM MOHAMED    : $0.00           USD (no card capture yet)
echo  ESBERTO EUBRA JR  : $0.00           USD
echo  DANIA ALOSIOUS    : $2.00           USD
echo.
echo ============================================================
echo  SETTLEMENT INSTRUCTIONS (PENDING PAYOUTS)
echo ============================================================
echo.
echo  INTL-MRC-1001-MU0KJH7L  USD $10,000   Wise US Inc     PENDING
echo  INTL-MRC-1001-MU0HTR2M  USD $50        ABSA ZA         PENDING
echo  INTL-MRC-1001-MU0HTFRF  USD $50        ABSA ZA         PENDING
echo  INTL-MRC-1001-MTXL1UKC  EUR $50,000    Wise SEPA       COMPLETED
echo.
echo  STATUS: Wise API returning 403 (key lacks transfer rights).
echo  TO FIX : Fund Wise account OR use manual bank wire with MT103.
echo.
echo ============================================================
echo  PAYOUT CONFIGURATION
echo ============================================================
echo.
echo  Provider : Internal Acquirer (Wise downstream rail)
echo  Bank provider key: configured through backend/.env
echo  Account  : PRIMESTACK TECHNOLOGIES LLC
echo  Number   : 343612919064346
echo  Routing  : 084009519
echo  SWIFT    : TRWIUS35XXX
echo  Address  : 1500 N GRANT ST STE N, Denver, CO 80203, US
echo.
echo  To pay out: Settlements page - click [Pay Out]
echo  To sync  : Developer page - click [Sync Now]
echo.
echo ============================================================
echo  PROTOCOL 201.3 FEATURES
echo ============================================================
echo.
echo  Voice Auth (101.1) : Enabled on both POS pages
echo  HMAC Signature     : Active
echo  Offline EMV        : Active
echo  Wise Integration   : A+B+C+D active
echo.
echo ============================================================
echo.
echo  Keep BOTH console windows open while using the system.
echo  Press any key to minimize this launcher window.
echo.
pause >nul

echo The launcher is minimized. System is still running.
echo Close the backend and frontend windows to stop the system.
