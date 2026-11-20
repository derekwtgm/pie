@echo off
rem EightMax Test Workbench 0.35.0 - compare multi-table memory: 0.31 per-worker preflop reader vs 0.32 shared preflop snapshot (same workload).
rem Strategy library: %LOCALAPPDATA%\EightMax-Test-Workbench\StrategyLibrary (set EIGHTMAX_STRATEGY_LIBRARY to use another folder).
setlocal
set "HERE=%~dp0"
if not exist "%HERE%runtime\node\node.exe" ( echo runtime\node\node.exe is missing; re-extract the ZIP. & pause & exit /b 3 )
if "%EIGHTMAX_TEST_CLI%"=="" set "EIGHTMAX_TEST_CLI=%HERE%native\mwcli.exe"
cd /d "%HERE%"
echo Memory check (two short simulated runs). Results: Research panel in the dashboard.
"%HERE%runtime\node\node.exe" tools\memory-check-032.cjs --out="%LOCALAPPDATA%\EightMax-Test-Workbench\memory-latest.json" %*
set "RC=%ERRORLEVEL%"
echo.
if "%NOPAUSE%"=="" pause
exit /b %RC%
