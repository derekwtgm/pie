@echo off
rem EightMax Test Workbench 0.35.0 - compare the preflop solver modes (A full linked, B169 compact check-down) at 2,000,000 updates; add --updates=8000000 to continue training
setlocal
set "HERE=%~dp0"
if not exist "%HERE%runtime\node\node.exe" ( echo runtime\node\node.exe is missing; re-extract the ZIP. & pause & exit /b 3 )
if "%EIGHTMAX_TEST_CLI%"=="" set "EIGHTMAX_TEST_CLI=%HERE%native\mwcli.exe"
if not exist "%LOCALAPPDATA%\EightMax-Test-Workbench" mkdir "%LOCALAPPDATA%\EightMax-Test-Workbench"
cd /d "%HERE%"
echo compare the preflop solver modes (A full linked, B169 compact check-down) at 2,000,000 updates; add --updates=8000000 to continue training (about 10-20 minutes; Mode A needs about 3 GB of RAM). Results: Solver research panel in the dashboard.
"%HERE%runtime\node\node.exe" tools\preflop-modes-033.cjs --modes=B169,A --seeds=8 --updates=2000000 --emz --budgetMiB=12000 --cache="%LOCALAPPDATA%\EightMax-Test-Workbench\PreflopModes" --out="%LOCALAPPDATA%\EightMax-Test-Workbench\preflop-modes-latest.json" %*
set "RC=%ERRORLEVEL%"
"%HERE%runtime\node\node.exe" tools\research-summary-033.cjs >nul 2>&1
echo.
if "%NOPAUSE%"=="" pause
exit /b %RC%
