@echo off
rem EightMax Test Workbench 0.35.0 - open the bundled controlled test tables (input-validation fixture) to try Simulator Controls by hand.
rem Usage: START-TEST-TABLES.cmd [number of tables, default 2]. Close this window to close the tables.
setlocal
cd /d "%~dp0"
set N=%1
if "%N%"=="" set N=2
set OUT=%LOCALAPPDATA%\EightMax-Test-Workbench\Acceptance-0.35\manual-tables
if not exist "%OUT%" mkdir "%OUT%"
"%~dp0runtime\node\node.exe" tools\test-table-035.cjs --tables %N% --oracle-dir "%OUT%" --turn-delay 1500
endlocal
