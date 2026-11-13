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
rem 4.8: checks of the 4.8 changes (continuation fixture, evaluation identity, comparison classes)
call "%~dp0Run 4.8 checks.bat" /nopause
set "eightmax_48_result=%errorlevel%"
if not "%eightmax_48_result%"=="0" set "eightmax_test_result=%eightmax_48_result%"
rem 4.9: compressed-checkpoint restoration checks
call "%~dp0Run 4.9 checks.bat" /nopause
set "eightmax_49_result=%errorlevel%"
if not "%eightmax_49_result%"=="0" set "eightmax_test_result=%eightmax_49_result%"
pause
exit /b %eightmax_test_result%
