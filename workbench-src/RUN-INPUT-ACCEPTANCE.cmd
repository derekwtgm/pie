@echo off
rem EightMax Test Workbench 0.35.0 - input acceptance on the bundled controlled test tables (real cursor and keyboard, ~2 minutes).
rem Two test-table windows open; the cursor moves by itself. Do not touch the mouse or keyboard until it says Done.
setlocal
cd /d "%~dp0"
set OUT=%LOCALAPPDATA%\EightMax-Test-Workbench\Acceptance-0.35
if not exist "%OUT%" mkdir "%OUT%"
"%~dp0runtime\node\node.exe" tools\input-acceptance-035.cjs --out "%OUT%\input-acceptance.json" --oracle-dir "%OUT%\oracle"
echo Done. Report: %OUT%\input-acceptance.json
pause
endlocal
