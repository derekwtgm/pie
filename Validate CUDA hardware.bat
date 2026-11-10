@echo off
cd /d "%~dp0"
echo EightMax 3.8 CPU/CUDA hardware validation. This takes a few minutes.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "source\tools\validate_hardware.ps1"
set "eightmax_test_result=%errorlevel%"
if not "%eightmax_test_result%"=="0" echo A hardware check failed. Please keep hardware-validation.json.
pause
exit /b %eightmax_test_result%
