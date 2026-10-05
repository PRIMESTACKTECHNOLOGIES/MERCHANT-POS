@echo off
REM ============================================================
REM  POS SYSTEM - QUICK START
REM ============================================================
REM  This will start both backend and frontend servers.
REM  The browser is intentionally not opened automatically.
REM ============================================================

title Starting POS System...

cd /d "%~dp0"

echo.
echo  Starting POS System...
echo  Please wait...
echo.

REM Start backend
start "Backend" cmd /k "cd /d ""%~dp0backend"" && title Backend Server (Port 7000) && npm run dev"

REM Start frontend
start "Frontend" cmd /k "cd /d ""%~dp0client"" && title Frontend Client (Port 7001) && npm run dev"

REM Wait for the backend health endpoint instead of assuming a fixed startup time
echo  Waiting for backend health check...
set "BACKEND_READY="
for /l %%I in (1,1,60) do (
  curl.exe --silent --show-error --fail http://localhost:7000/health >nul 2>&1
  if not errorlevel 1 (
    set "BACKEND_READY=1"
    goto :backend_ready
  )
  timeout /t 1 /nobreak >nul
)

:backend_ready
if not defined BACKEND_READY (
  echo  Backend did not become ready within 60 seconds.
  echo  Check the Backend console window for errors.
  exit /b 1
)

REM Wait for the frontend HTTP server before opening the browser
echo  Waiting for frontend health check...
set "FRONTEND_READY="
for /l %%I in (1,1,60) do (
  curl.exe --silent --show-error --fail http://localhost:7001 >nul 2>&1
  if not errorlevel 1 (
    set "FRONTEND_READY=1"
    goto :frontend_ready
  )
  timeout /t 1 /nobreak >nul
)

:frontend_ready
if not defined FRONTEND_READY (
  echo  Frontend did not become ready within 60 seconds.
  echo  Check the Frontend console window for errors.
  exit /b 1
)

REM Browser launch is intentionally disabled; open the frontend URL manually.
echo.
echo  System started!
echo  - Backend: http://localhost:7000
echo  - Frontend: http://localhost:7001
echo.
echo  Keep both console windows open.
echo.

exit
