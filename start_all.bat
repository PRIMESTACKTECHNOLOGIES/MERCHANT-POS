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
set "VAULT_BANK_PORT=9001"
set "POS_FRONTEND_PORT=7001"
set "FRONTEND_PORT=7002"
set "BACKEND_DIR=%PROJECT_ROOT%backend"
set "FRONTEND_DIR=%PROJECT_ROOT%client"
set "DATABASE_FILE=%PROJECT_ROOT%backend\data\database.sqlite"

title POS 201.3 System Launcher

cls
echo.
echo ============================================================
echo  VAULT BANK DASHBOARD - ONE CLICK START
echo ============================================================
echo.
echo  Dashboard URL : http://localhost:%FRONTEND_PORT%/vault-bank
echo  POS Dashboard  : http://localhost:%POS_FRONTEND_PORT%/overview
echo  Backend API   : http://localhost:%BACKEND_PORT%
echo  Vault API     : http://127.0.0.1:%VAULT_BANK_PORT%/health
echo.
echo ============================================================
echo.

REM ── Kill any existing processes on ports 7000, 7001, 7002 and 9001 ───────
echo [INFO] Clearing ports %BACKEND_PORT%, %POS_FRONTEND_PORT%, %FRONTEND_PORT% and %VAULT_BANK_PORT%...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%BACKEND_PORT%.*LISTENING" 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%FRONTEND_PORT%.*LISTENING" 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%POS_FRONTEND_PORT%.*LISTENING" 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%VAULT_BANK_PORT%.*LISTENING" 2^>nul') do (
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

cd /d "%PROJECT_ROOT%"

REM ── Start backend ─────────────────────────────────────────────────────────
echo [3/4] Starting backend server on port %BACKEND_PORT%...
start "POS Backend (201.3)" cmd /k "title POS Backend 201.3 && cd /d ""%BACKEND_DIR%"" && echo Starting POS 201.3 Backend... && echo Database: %DATABASE_FILE% && npm run dev"
start "Private Vault Bank (9001)" cmd /k "title Private Vault Bank 9001 && cd /d ""%BACKEND_DIR%"" && echo Starting private vault-bank service... && npm run dev:vault-bank"

REM Wait for backend
echo [INFO] Waiting for backend to start...
ping -n 8 127.0.0.1 >nul

REM ── Start frontends ───────────────────────────────────────────────────────
echo [4/5] Starting POS dashboard on port %POS_FRONTEND_PORT%...
start "POS Dashboard (7001)" cmd /k "title POS Dashboard 7001 && cd /d ""%FRONTEND_DIR%"" && echo Starting POS dashboard... && set VITE_APP_MODE=pos && set VITE_API_URL=http://127.0.0.1:%BACKEND_PORT% && call npm run dev -- --host 0.0.0.0 --port %POS_FRONTEND_PORT%"

echo [5/5] Starting vault-bank dashboard on port %FRONTEND_PORT%...
start "Vault Bank Dashboard (7002)" cmd /k "title Vault Bank Dashboard 7002 && cd /d ""%FRONTEND_DIR%"" && echo Starting vault-bank dashboard... && set VITE_APP_MODE=vault-bank && set VITE_API_URL=http://127.0.0.1:%BACKEND_PORT% && call npm run dev -- --host 0.0.0.0 --port %FRONTEND_PORT%"

REM Wait for frontend
echo [INFO] Waiting for vault-bank dashboard to start...
ping -n 10 127.0.0.1 >nul

REM ── Browser is left to the operator to open manually ─────────────────────
echo [INFO] Browser launch disabled. Open the URLs manually in your browser.

echo.
echo ============================================================
echo  VAULT BANK SYSTEM IS RUNNING
echo ============================================================
echo.
echo  Status        : ONLINE
echo  Dashboard URL : http://127.0.0.1:%FRONTEND_PORT%/vault-bank
echo  POS Dashboard  : http://127.0.0.1:%POS_FRONTEND_PORT%/overview
echo  Backend API   : http://localhost:%BACKEND_PORT%
echo  Vault API     : http://127.0.0.1:%VAULT_BANK_PORT%/health
echo.
echo ============================================================
echo  OPEN THIS URL
echo ============================================================
echo.
echo  http://127.0.0.1:%FRONTEND_PORT%/vault-bank
echo  http://127.0.0.1:%POS_FRONTEND_PORT%/overview
echo.
echo ============================================================
echo  CONFIGURATION
echo ============================================================
echo.
echo  Vault transfer credentials: backend\.env
echo.
echo ============================================================
echo  Keep the backend, vault-bank, and dashboard windows open.
echo  Press any key to minimize this launcher window.
echo.
pause >nul

echo The launcher is minimized. System is still running.
echo Close the backend, vault-bank, and frontend windows to stop the system.
