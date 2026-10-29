@echo off
setlocal
title Build customer portal (Netlify)

rem ---------------------------------------------------------------------------
rem Builds client\dist-portal with the backend API URL baked in.
rem Upload the resulting dist-portal folder to Netlify.
rem
rem To use a different backend URL, run this before the script, e.g.
rem     set VITE_API_URL=https://my-other-host
rem     build-customer-portal.bat
rem ---------------------------------------------------------------------------

if "%VITE_API_URL%"=="" set "VITE_API_URL=https://merchant-pos-0nno.onrender.com"

cd /d "%~dp0client"
if errorlevel 1 (
  echo ERROR: could not find the "client" folder next to this script.
  goto :fail
)

if not exist "node_modules" (
  echo Installing dependencies ^(first run only^)...
  call npm install
  if errorlevel 1 goto :fail
)

echo.
echo Building portal with API: %VITE_API_URL%
echo.

call npm run build:portal
if errorlevel 1 goto :fail

echo.
echo ===========================================================
echo   BUILD OK
echo.
echo   Upload this folder to Netlify:
echo   %~dp0client\dist-portal
echo ===========================================================
echo.
pause
exit /b 0

:fail
echo.
echo ===========================================================
echo   BUILD FAILED - read the errors above.
echo ===========================================================
echo.
pause
exit /b 1
