@echo off
rem EightMax Test Workbench 0.35.0 - train missing strategies in the background (Study Mode work; nothing is played).
rem Strategy library: %LOCALAPPDATA%\EightMax-Test-Workbench\StrategyLibrary (set EIGHTMAX_STRATEGY_LIBRARY to use another folder).
setlocal
set "HERE=%~dp0"
if not exist "%HERE%runtime\node\node.exe" ( echo runtime\node\node.exe is missing; re-extract the ZIP. & pause & exit /b 3 )
if "%EIGHTMAX_TEST_CLI%"=="" set "EIGHTMAX_TEST_CLI=%HERE%native\mwcli.exe"
cd /d "%HERE%"
echo Training the situations your simulations needed most (from the miss log), then anything already queued.
echo You can close this window at any time: running work is checkpointed and continues next time.
"%HERE%runtime\node\node.exe" tools\strategy-library.cjs precompute --from-misses=500 %*
set "RC=%ERRORLEVEL%"
echo.
if "%NOPAUSE%"=="" pause
exit /b %RC%
