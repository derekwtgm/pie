@echo off
cd /d "%~dp0"
echo Checking the EightMax Windows CPU engine...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0validation\3.7\windows-release.ps1"
set "eightmax_test_result=%errorlevel%"
echo.
if not "%eightmax_test_result%"=="0" echo A check failed. Please keep Windows-self-test.json.
pause
exit /b %eightmax_test_result%
