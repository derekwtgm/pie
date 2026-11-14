@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "source\tools\test_devices.ps1" -Repeats 5
if errorlevel 1 echo Device comparison failed. Review the message above.
pause
