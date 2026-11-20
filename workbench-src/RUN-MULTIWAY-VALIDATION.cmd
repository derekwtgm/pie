@echo off
rem EightMax Test Workbench 0.35.0 - check the independent multiway evaluator (analytic games, engine cross-check)
setlocal
set "HERE=%~dp0"
if not exist "%HERE%runtime\node\node.exe" ( echo runtime\node\node.exe is missing; re-extract the ZIP. & pause & exit /b 3 )
if "%EIGHTMAX_TEST_CLI%"=="" set "EIGHTMAX_TEST_CLI=%HERE%native\mwcli.exe"
if not exist "%LOCALAPPDATA%\EightMax-Test-Workbench" mkdir "%LOCALAPPDATA%\EightMax-Test-Workbench"
cd /d "%HERE%"
echo check the independent multiway evaluator (analytic games, engine cross-check) (about 2-5 minutes). Results: Solver research panel in the dashboard.
"%HERE%runtime\node\node.exe" tools\multiway-validation-033.cjs --quick --out="%LOCALAPPDATA%\EightMax-Test-Workbench\multiway-validation-latest.json" %*
set "RC=%ERRORLEVEL%"
"%HERE%runtime\node\node.exe" tools\research-summary-033.cjs >nul 2>&1
echo.
if "%NOPAUSE%"=="" pause
exit /b %RC%
