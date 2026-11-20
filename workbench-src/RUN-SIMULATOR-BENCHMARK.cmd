@echo off
rem EightMax Test Workbench 0.35.0 - END-TO-END multi-table benchmark: capture, recognition, decision, visible input and confirmation
rem on 1, 2, 5, 8 and 10 controlled test tables (about 8 minutes). Close the desktop host first (it uses the same local port).
rem Do not touch the mouse or keyboard while it runs. Add --tables 1,2 --seconds 40 for a shorter run.
setlocal
cd /d "%~dp0"
set OUT=%LOCALAPPDATA%\EightMax-Test-Workbench\Acceptance-0.35
if not exist "%OUT%" mkdir "%OUT%"
"%~dp0runtime\node\node.exe" tools\simulator-benchmark-035.cjs --out "%OUT%\simulator-benchmark.json" --work "%OUT%\benchmark-work" %*
echo Done. Report: %OUT%\simulator-benchmark.json
pause
endlocal
