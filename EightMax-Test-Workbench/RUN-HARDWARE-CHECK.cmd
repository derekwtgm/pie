@echo off
setlocal
cd /d "%~dp0"
echo EightMax Test Workbench - hardware validation (no GPU acceleration is claimed)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\Test-Hardware.ps1"
if errorlevel 1 (echo Hardware validation failed. See the message above.) else echo Done.
pause
endlocal
