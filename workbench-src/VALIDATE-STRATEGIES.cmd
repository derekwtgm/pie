@echo off
rem EightMax Test Workbench 0.35.0 - check the mathematical accuracy of stored strategies (exact checks on rivers; turns and flops when a linked continuation record exists, otherwise unverified).
rem Strategy library: %LOCALAPPDATA%\EightMax-Test-Workbench\StrategyLibrary (set EIGHTMAX_STRATEGY_LIBRARY to use another folder).
setlocal
set "HERE=%~dp0"
if not exist "%HERE%runtime\node\node.exe" ( echo runtime\node\node.exe is missing; re-extract the ZIP. & pause & exit /b 3 )
if "%EIGHTMAX_TEST_CLI%"=="" set "EIGHTMAX_TEST_CLI=%HERE%native\mwcli.exe"
cd /d "%HERE%"
echo Checking stored strategies. Results: Strategy quality panel in the dashboard.
"%HERE%runtime\node\node.exe" tools\strategy-library.cjs quality %*
set "RC=%ERRORLEVEL%"
echo.
if "%NOPAUSE%"=="" pause
exit /b %RC%
