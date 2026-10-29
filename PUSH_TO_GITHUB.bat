@echo off
setlocal
REM ============================================================================
REM  GITHUB PUSH SCRIPT - Push POS System to GitHub (and let Render redeploy)
REM ============================================================================

cls
echo.
echo ============================================================
echo   PUSH POS SYSTEM TO GITHUB
echo ============================================================
echo.

cd /d "%~dp0"

REM ---- Git installed? -------------------------------------------------------
git --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Git is not installed.
    echo  Install it from https://git-scm.com/
    echo.
    pause
    exit /b 1
)

REM ---- Repository present? --------------------------------------------------
if not exist ".git" (
    echo  No .git folder found - initializing a new repository...
    git init
    git branch -M main
    echo.
    echo  A remote is required before pushing. Run:
    echo     git remote add origin https://github.com/USERNAME/REPO.git
    echo  then run this script again.
    echo.
    pause
    exit /b 1
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
    echo  ERROR: remote 'origin' is not configured. Run:
    echo     git remote add origin https://github.com/USERNAME/REPO.git
    echo.
    pause
    exit /b 1
)

REM ---- Resolve branch + remote ----------------------------------------------
set "BRANCH="
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%b"
if "%BRANCH%"=="" set "BRANCH=main"

set "REMOTE="
for /f "delims=" %%r in ('git remote get-url origin') do set "REMOTE=%%r"

REM Strip any user:token@ prefix so credentials are never echoed to screen.
set "REMOTE_SHOWN=%REMOTE:*@=%"

echo  Branch : %BRANCH%
echo  Remote : %REMOTE_SHOWN%
echo.
echo  Current git status:
git status --short
echo.

if not "%REMOTE:github.com=%"=="%REMOTE%" (
    if not "%REMOTE:@=%"=="%REMOTE%" (
        echo  SECURITY NOTE: the remote URL has an access token embedded in it and
        echo  that token sits in .git/config in plain text. Prefer a credential
        echo  helper - git config --global credential.helper manager - and rotate
        echo  the token if this file or your screen has ever been shared.
        echo.
    )
)

REM ---- Commit message -------------------------------------------------------
REM NOTE: %DATE%/%TIME% are read at top level (never inside a parenthesised
REM block) so the auto-generated message is not empty.
set "commit_msg="
set /p commit_msg="Enter commit message (or press Enter for auto-generated): "
if "%commit_msg%"=="" set "commit_msg=Auto-update: %DATE% %TIME%"
set commit_msg=%commit_msg:"=%

REM ---- Stage ----------------------------------------------------------------
echo.
echo  Staging files...
git add .
if errorlevel 1 (
    echo  FAILED to stage files.
    pause
    exit /b 1
)

REM ---- Commit (only when something is actually staged) ----------------------
git diff --cached --quiet
if errorlevel 1 (
    echo  Creating commit: "%commit_msg%"
    git commit -m "%commit_msg%"
    if errorlevel 1 (
        echo  FAILED to commit.
        pause
        exit /b 1
    )
    echo  Commit created.
) else (
    echo  Nothing new to commit - skipping the commit step.
)

REM ---- Push (retry once after a rebase if the remote moved ahead) -----------
echo.
echo  Pushing to origin/%BRANCH% ...
git push -u origin %BRANCH%
if errorlevel 1 (
    echo.
    echo  Push was rejected - origin/%BRANCH% has commits you do not have yet.
    echo  Syncing with a rebase and retrying...
    git pull --rebase origin %BRANCH%
    if errorlevel 1 (
        echo.
        echo  Sync failed. Resolve the conflicts, then run this script again.
        pause
        exit /b 1
    )
    echo  Retrying push...
    git push -u origin %BRANCH%
    if errorlevel 1 (
        echo.
        echo  PUSH FAILED. Check the error above.
        echo    1. Verify remote   : git remote -v
        echo    2. Check GitHub credentials
        echo    3. Check internet connection
        echo.
        pause
        exit /b 1
    )
)

echo.
echo ============================================================
echo   SUCCESS - code pushed to GitHub
echo ============================================================
echo.
echo  Render will rebuild automatically if Auto-Deploy is ON for
echo  branch %BRANCH%. Watch it at https://dashboard.render.com
echo.
echo  Recent commits:
git log --oneline -5
echo.
pause
endlocal
