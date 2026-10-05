@echo off
cd /d "c:\Users\Public\POS PROJECT\POS ORGINAL\android_pos_app"
gradlew.bat assembleDebug > build_result.txt 2>&1
echo Exit: %ERRORLEVEL% >> build_result.txt
