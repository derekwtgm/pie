@echo off
rem EightMax Test Workbench 0.35.0 - play simulated hands to find the most common situations, then train them (about one hour by default; --minutes=N to change).
rem Strategy library: %LOCALAPPDATA%\EightMax-Test-Workbench\StrategyLibrary (set EIGHTMAX_STRATEGY_LIBRARY to use another folder).
setlocal
set "HERE=%~dp0"
if not exist "%HERE%runtime\node\node.exe" ( echo runtime\node\node.exe is missing; re-extract the ZIP. & pause & exit /b 3 )
if "%EIGHTMAX_TEST_CLI%"=="" set "EIGHTMAX_TEST_CLI=%HERE%native\mwcli.exe"
cd /d "%HERE%"
echo Finding and training the most common situations. This takes a while; you can close the window to stop.
"%HERE%runtime\node\node.exe" tools\strategy-library.cjs common %*
set "RC=%ERRORLEVEL%"
echo.
if "%NOPAUSE%"=="" pause
exit /b %RC%
