@echo off
SETLOCAL EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

set "BACKEND_PORT=7000"
set "FRONTEND_PORT=7001"

title POS Offline System Launcher

cls
echo.
echo POS OFFLINE SYSTEM - ONE CLICK START
echo Backend: http://localhost:%BACKEND_PORT%
echo Frontend: http://localhost:%FRONTEND_PORT%
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo Error: Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

if not exist "%~dp0backend\node_modules" (
    echo [1/3] Installing backend dependencies...
    cd /d "%~dp0backend"
    call npm install
    if errorlevel 1 (
        echo Failed to install backend dependencies.
        pause
        exit /b 1
    )
) else (
    echo [1/3] Backend dependencies already installed.
)

if not exist "%~dp0client\node_modules" (
    echo [2/3] Installing frontend dependencies...
    cd /d "%~dp0client"
    call npm install
    if errorlevel 1 (
        echo Failed to install frontend dependencies.
        pause
        exit /b 1
    )
) else (
    echo [2/3] Frontend dependencies already installed.
)

cd /d "%~dp0"

echo [3/3] Starting backend and frontend...
start "POS Backend" cmd /k "cd /d ""%~dp0backend"" && set PORT=%BACKEND_PORT% && set JWT_SECRET=offline-pos-kodolo-2026-jwt-secret-change-live && npm run dev"
start "POS Frontend" cmd /k "cd /d ""%~dp0client"" && set VITE_API_URL=http://localhost:%BACKEND_PORT% && npm run dev -- --host 0.0.0.0 --port %FRONTEND_PORT%"

echo.
echo Waiting for the backend and frontend to become ready...
set "BACKEND_READY=0"
set "FRONTEND_READY=0"
set /a WAIT_SECONDS=0

:WAIT_FOR_SERVICES
if "%BACKEND_READY%"=="0" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:%BACKEND_PORT%/health' -TimeoutSec 2; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
    if not errorlevel 1 (
        set "BACKEND_READY=1"
        echo Backend is ready: http://localhost:%BACKEND_PORT%
    )
)

if "%FRONTEND_READY%"=="0" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:%FRONTEND_PORT%/' -TimeoutSec 2; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
    if not errorlevel 1 (
        set "FRONTEND_READY=1"
        echo Frontend is ready: http://localhost:%FRONTEND_PORT%
    )
)

if "%BACKEND_READY%"=="1" if "%FRONTEND_READY%"=="1" goto SERVICES_READY

if %WAIT_SECONDS% GEQ 120 (
    echo.
    echo ERROR: Services did not become ready within 120 seconds.
    echo Keep the CMD windows open and check their error messages.
    powershell -NoProfile -Command "[Console]::Beep(500,400)" >nul 2>nul
    pause
    exit /b 1
)

timeout /t 2 /nobreak >nul
set /a WAIT_SECONDS+=2
goto WAIT_FOR_SERVICES

:SERVICES_READY
echo.
echo All POS services are ready. Opening the POS in your default browser...
start "" "http://localhost:%FRONTEND_PORT%"
powershell -NoProfile -Command "[Console]::Beep(1400,180); [Console]::Beep(1800,220)" >nul 2>nul

echo.
echo System is running.
echo Frontend: http://localhost:%FRONTEND_PORT%
echo Backend : http://localhost:%BACKEND_PORT%
echo NFC     : ACR122U PC/SC reader enabled
echo.
echo Keep both console windows open while using the system.
echo.
pause
