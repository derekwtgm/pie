@echo off
rem EightMax Test Workbench 0.35.0 - all Simulator Controls checks for THIS PC: input self-test, input acceptance and the multi-table benchmark
rem (about 12 minutes; the cursor moves by itself - do not touch the mouse or keyboard). Close the desktop host first. Then run COLLECT-TEST-RESULTS.cmd.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0windows\Test-Input.ps1" %*
pause
