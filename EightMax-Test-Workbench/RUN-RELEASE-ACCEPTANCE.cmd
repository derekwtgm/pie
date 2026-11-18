@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0windows\Test-Release.ps1" %*
pause
endlocal
