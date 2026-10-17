@echo off
REM ============================================================
REM  PRIMESTACK POS — QUICK START
REM  Starts backend + frontend + enables ACR122U NFC reader
REM ============================================================

title PRIMESTACK POS — Quick Start

cd /d "%~dp0"

echo.
echo  PRIMESTACK POS — Starting...
echo.

REM ── Enable PC/SC for ACR122U ─────────────────────────────────────────────
echo  [NFC] Enabling PC/SC service for ACR122U card reader...
sc query SCardSvr | findstr "RUNNING" >nul 2>&1
if errorlevel 1 (
    net start SCardSvr >nul 2>&1
    if errorlevel 1 (
        echo  [NFC] WARNING: Run as Administrator to enable ACR122U support.
    ) else (
        echo  [NFC] PC/SC started. ACR122U will be detected automatically.
    )
) else (
    echo  [NFC] PC/SC already running. ACR122U ready.
)
echo.

REM ── Start backend ────────────────────────────────────────────────────────
echo  [1/2] Starting backend on port 7000...
start "Backend :7000" cmd /k "cd /d ""%~dp0backend"" && title Backend :7000 && echo Backend: http://localhost:7000 && echo ACR122U: http://localhost:7000/merchant/v1/payments/read-acr122u/status && npm run dev"

REM ── Start frontend ───────────────────────────────────────────────────────
echo  [2/2] Starting POS dashboard on port 7001...
start "POS Dashboard :7001" cmd /k "cd /d ""%~dp0client"" && title POS Dashboard :7001 && set VITE_API_URL=http://127.0.0.1:7000 && npm run dev -- --port 7001"

REM ── Wait for backend ─────────────────────────────────────────────────────
echo.
echo  Waiting for backend...
set "READY="
for /l %%I in (1,1,60) do (
    curl.exe --silent --fail http://localhost:7000/health >nul 2>&1
    if not errorlevel 1 ( set "READY=1" & goto :ok )
    timeout /t 1 /nobreak >nul
)
:ok
if not defined READY (
    echo  [WARNING] Backend not ready. Check Backend window for errors.
) else (
    echo  [OK] Backend live.
)

REM ── Wait for frontend ────────────────────────────────────────────────────
echo  Waiting for dashboard...
set "FREADY="
for /l %%I in (1,1,60) do (
    curl.exe --silent --fail http://localhost:7001 >nul 2>&1
    if not errorlevel 1 ( set "FREADY=1" & goto :fok )
    timeout /t 1 /nobreak >nul
)
:fok
if not defined FREADY (
    echo  [WARNING] Dashboard not ready. Check Dashboard window for errors.
) else (
    echo  [OK] Dashboard live.
)

echo.
echo ============================================================
echo   SYSTEM READY
echo ============================================================
echo.
echo   POS Dashboard  : http://localhost:7001/overview
echo   Backend API    : http://localhost:7000
echo   ACR122U NFC    : http://localhost:7000/merchant/v1/payments/read-acr122u/status
echo   Android NFC    : Tap card on phone (uses Render backend)
echo   Live Site      : https://merchantpos.netlify.app
echo.
echo   Keep both console windows open.
echo ============================================================
echo.
pause
