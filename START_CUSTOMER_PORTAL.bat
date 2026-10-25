@echo off
REM ============================================================
REM  PRIMESTACK POS - LOCAL DASHBOARDS LAUNCHER
REM  Starts backend (7000) + frontend (7001), then opens:
REM    1. Merchant / Admin dashboard
REM    2. Vault Bank dashboard
REM    3. Customer portal
REM  The browser is opened as soon as the frontend is up - it does
REM  NOT wait for the backend, which is slow to boot on this drive.
REM ============================================================

title PRIMESTACK POS - Dashboards

cd /d "%~dp0"

set "BACKEND_PORT=7000"
set "FRONTEND_PORT=7001"

echo.
echo  PRIMESTACK POS - starting local dashboards...
echo.

REM -- Check Node.js ------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo  [ERROR] Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)

REM -- Install dependencies if missing ------------------------------------
if not exist "%~dp0backend\node_modules" (
    echo  [SETUP] Installing backend dependencies ^(this can take a while^)...
    pushd "%~dp0backend"
    call npm install --no-audit --no-fund
    popd
)

if not exist "%~dp0client\node_modules" (
    echo  [SETUP] Installing frontend dependencies ^(this can take a while^)...
    pushd "%~dp0client"
    call npm install --no-audit --no-fund
    popd
)

REM -- Verify the backend can load its entry modules ----------------------
pushd "%~dp0backend"
node -e "require.resolve('fast-xml-parser')" >nul 2>nul
if errorlevel 1 (
    echo  [SETUP] Installing a missing backend module ^(fast-xml-parser^)...
    call npm install fast-xml-parser --no-audit --no-fund
)
popd

REM -- Start backend (skip if already listening) --------------------------
netstat -ano | findstr /r /c:":%BACKEND_PORT% .*LISTENING" >nul 2>nul
if errorlevel 1 (
    echo  [1/2] Starting backend on port %BACKEND_PORT%...
    start "Backend :%BACKEND_PORT%" cmd /k "cd /d ""%~dp0backend"" && title Backend :%BACKEND_PORT% && npm run dev"
) else (
    echo  [1/2] Backend already running on port %BACKEND_PORT% - reusing it.
)

REM -- Start frontend (skip if already listening) -------------------------
netstat -ano | findstr /r /c:":%FRONTEND_PORT% .*LISTENING" >nul 2>nul
if errorlevel 1 (
    echo  [2/2] Starting frontend on port %FRONTEND_PORT%...
    start "Frontend :%FRONTEND_PORT%" cmd /k "cd /d ""%~dp0client"" && title Frontend :%FRONTEND_PORT% && set VITE_API_URL=http://127.0.0.1:%BACKEND_PORT% && npm run dev -- --port %FRONTEND_PORT%"
) else (
    echo  [2/2] Frontend already running on port %FRONTEND_PORT% - reusing it.
)

REM -- Wait for the frontend only (this is fast) --------------------------
echo.
echo  Waiting for the dashboard to come up...
set "FRONTEND_READY="
set /a "felapsed=0"
:wait_fe
curl.exe --silent --fail http://localhost:%FRONTEND_PORT% >nul 2>&1
if not errorlevel 1 goto frontend_ok
set /a "felapsed+=2"
if %felapsed% GEQ 120 goto frontend_timeout
timeout /t 2 /nobreak >nul
goto wait_fe

:frontend_ok
echo  [OK] Dashboard live on port %FRONTEND_PORT%.
goto open_browsers

:frontend_timeout
echo.
echo  [WARNING] Dashboard did not respond within 120s.
echo            Check the "Frontend :%FRONTEND_PORT%" window. Vite may have
echo            picked a different port (look for "Local: http://localhost:XXXX").

:open_browsers
echo.
echo  Opening the three dashboards in your browser...
start "" "http://localhost:%FRONTEND_PORT%/login"
timeout /t 1 /nobreak >nul
start "" "http://localhost:%FRONTEND_PORT%/vault-bank"
timeout /t 1 /nobreak >nul
start "" "http://localhost:%FRONTEND_PORT%/portal/login"
timeout /t 1 /nobreak >nul

REM -- Report backend status (do NOT block the browser opening) -----------
echo.
curl.exe --silent --fail http://127.0.0.1:%BACKEND_PORT%/health >nul 2>&1
if not errorlevel 1 (
    echo  [OK] Backend is live on port %BACKEND_PORT%.
    goto summary
)
echo  [WAIT] Backend is still starting on port %BACKEND_PORT%.
echo         First boot on this drive is slow ^(full DB rewrite per statement^).
echo         Login will fail with "Failed to fetch" until it is up.
echo.
echo         Waiting for the backend - leave this window open...
set "elapsed=0"
:wait_backend
curl.exe --silent --fail http://127.0.0.1:%BACKEND_PORT%/health >nul 2>&1
if not errorlevel 1 goto backend_ok
set /a "elapsed+=5"
if %elapsed% GEQ 1800 goto backend_timeout
<nul set /p "=."
timeout /t 5 /nobreak >nul
goto wait_backend

:backend_ok
echo.
echo  [OK] Backend is live on port %BACKEND_PORT% ^(waited ~%elapsed%s^).
goto summary

:backend_timeout
echo.
echo  [WARNING] Backend not responding after 30 minutes.
echo            Check the "Backend :%BACKEND_PORT%" window for errors.

:summary
echo.
echo ============================================================
echo   LOCAL DASHBOARDS
echo ============================================================
echo.
echo   1. Merchant / Admin  : http://localhost:%FRONTEND_PORT%/login
echo                          ^(then it lands on /overview^)
echo   2. Vault Bank        : http://localhost:%FRONTEND_PORT%/vault-bank
echo   3. Customer Portal   : http://localhost:%FRONTEND_PORT%/portal/login
echo                          ^(wallet code + PIN - PIN issued by the merchant^)
echo.
echo   Backend API          : http://127.0.0.1:%BACKEND_PORT%
echo   Health               : http://127.0.0.1:%BACKEND_PORT%/health
echo.
echo   Merchant login       : admin / admin123
echo.
echo   Keep the Backend and Frontend console windows open.
echo ============================================================
echo.
pause
