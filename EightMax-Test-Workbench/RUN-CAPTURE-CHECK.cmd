@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\Test-Capture.ps1" %*
pause
