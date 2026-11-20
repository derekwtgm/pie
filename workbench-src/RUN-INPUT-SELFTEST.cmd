@echo off
rem EightMax Test Workbench 0.35.0 - input driver self-test: the driver moves the VISIBLE cursor into its own small test window,
rem clicks a button, types an amount, cancels a movement and tests the emergency hotkey. Do not touch the mouse for ~20 seconds.
setlocal
set OUT=%LOCALAPPDATA%\EightMax-Test-Workbench\Acceptance-0.35
if not exist "%OUT%" mkdir "%OUT%"
"%~dp0desktop\bin\EightMaxInput.exe" --selftest --out "%OUT%\input-selftest.json"
if errorlevel 1 (echo SELF-TEST FAILED - see %OUT%\input-selftest.json) else (echo Self-test passed. Report: %OUT%\input-selftest.json)
pause
endlocal
