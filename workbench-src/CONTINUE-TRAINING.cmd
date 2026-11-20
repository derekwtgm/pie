@echo off
rem EightMax Test Workbench 0.35.0 - train further the stored strategies whose accuracy is not good enough yet (checkpointed; close the window to stop).
rem Strategy library: %LOCALAPPDATA%\EightMax-Test-Workbench\StrategyLibrary (set EIGHTMAX_STRATEGY_LIBRARY to use another folder).
setlocal
set "HERE=%~dp0"
if not exist "%HERE%runtime\node\node.exe" ( echo runtime\node\node.exe is missing; re-extract the ZIP. & pause & exit /b 3 )
if "%EIGHTMAX_TEST_CLI%"=="" set "EIGHTMAX_TEST_CLI=%HERE%native\mwcli.exe"
cd /d "%HERE%"
echo Continuing training of strategies that did not reach the accuracy target. You can close this window at any time.
"%HERE%runtime\node\node.exe" tools\strategy-library.cjs refine %*
set "RC=%ERRORLEVEL%"
echo.
if "%NOPAUSE%"=="" pause
exit /b %RC%
