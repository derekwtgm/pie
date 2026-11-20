@echo off
rem 0.35.0: OPTIONAL rebuild of the Windows Graphics Capture helper from source (needs the .NET 8 SDK once). A prebuilt helper already ships.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\Build-WgcCapture.ps1" %*
pause
