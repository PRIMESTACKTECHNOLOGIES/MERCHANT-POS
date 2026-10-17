@echo off
cd /d "c:\Users\Public\POS PROJECT\POS ORGINAL\android_pos_app"
call gradlew.bat assembleRelease --no-daemon -x lint > ..\build_release_out.txt 2>&1
echo EXIT=%ERRORLEVEL% >> ..\build_release_out.txt
