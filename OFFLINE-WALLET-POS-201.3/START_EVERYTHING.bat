@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

set "BACKEND_PORT=7000"
set "FRONTEND_PORT=7001"

echo ===================================================
echo      POS OFFLINE SYSTEM - ONE CLICK START
echo ===================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo Error: Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

if not exist "backend\node_modules" (
    echo [1/3] Installing backend dependencies...
    cd backend
    call npm install
    if errorlevel 1 (
        echo Failed to install backend dependencies.
        pause
        exit /b 1
    )
    cd /d "%~dp0"
) else (
    echo [1/3] Backend dependencies already installed.
)

if not exist "client\node_modules" (
    echo [2/3] Installing frontend dependencies...
    cd client
    call npm install
    if errorlevel 1 (
        echo Failed to install frontend dependencies.
        pause
        exit /b 1
    )
    cd /d "%~dp0"
) else (
    echo [2/3] Frontend dependencies already installed.
)

echo [3/3] Starting backend and frontend...

start "POS Backend" cmd /k "cd /d ""%~dp0backend"" && set PORT=%BACKEND_PORT% && npm run dev"
start "POS Frontend" cmd /k "cd /d ""%~dp0client"" && npm run dev -- --host 0.0.0.0 --port %FRONTEND_PORT%"

timeout /t 12 /nobreak >nul

start http://localhost:%FRONTEND_PORT%

echo.
echo ===================================================
echo      SYSTEM IS RUNNING
echo ===================================================
echo.
echo  Frontend: http://localhost:%FRONTEND_PORT%
echo  Backend:  http://localhost:%BACKEND_PORT%
echo.
echo  Keep both console windows open while using the system.
echo.
pause
