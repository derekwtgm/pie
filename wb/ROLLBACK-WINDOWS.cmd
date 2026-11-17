@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0windows\Rollback-Workbench.ps1"
if errorlevel 1 pause
endlocal
