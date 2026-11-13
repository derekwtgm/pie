@echo off
cd /d "%~dp0"
echo Checking the EightMax Windows CPU engine...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0validation\4.6\windows-release.ps1"
set "eightmax_test_result=%errorlevel%"
echo.
if not "%eightmax_test_result%"=="0" echo A check failed. Please keep Windows-self-test.json.
echo.
rem 4.7: feature checks (compressed checkpoints, verification, comparison, monitoring)
call "%~dp0Run 4.7 checks.bat" /nopause
set "eightmax_47_result=%errorlevel%"
if not "%eightmax_47_result%"=="0" set "eightmax_test_result=%eightmax_47_result%"
pause
exit /b %eightmax_test_result%
