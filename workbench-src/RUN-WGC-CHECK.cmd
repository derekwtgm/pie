@echo off
rem 0.35.0: Windows Graphics Capture acceptance. The helper ships prebuilt in desktop\bin (cross-compiled; first Windows execution happens here).
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0windows\Test-Wgc.ps1" %*
pause
