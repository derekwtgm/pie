@echo off
cd /d "%~dp0"
echo EightMax 3.1 CPU/CUDA hardware validation. This takes a few minutes.
powershell -NoProfile -ExecutionPolicy Bypass -File "source\tools\validate_hardware.ps1"
if errorlevel 1 echo A hardware check failed. Please keep hardware-validation.json.
pause
