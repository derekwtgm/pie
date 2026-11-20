@echo off
rem EightMax Test Workbench 0.35.0 - one-click test-results collector.
rem Finds EightMax test reports, removes secrets and personal names from the copies, and saves ONE ZIP on your Desktop.
rem Original reports are only read: nothing is changed or deleted. No tests are run.
setlocal
cd /d "%~dp0"
echo Collecting EightMax test results...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0windows\Collect-TestResults.ps1" %*
if errorlevel 1 (echo Collection failed. See the message above.) else echo Done.
pause
endlocal
