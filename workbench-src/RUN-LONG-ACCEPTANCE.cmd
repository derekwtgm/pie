@echo off
rem EightMax Test Workbench 0.35.0 - long-duration hardware acceptance on this PC: ten tables, strategy library, precomputation, capture and memory (about 1-2 hours; results ZIP on the Desktop).
rem Strategy library: %LOCALAPPDATA%\EightMax-Test-Workbench\StrategyLibrary (set EIGHTMAX_STRATEGY_LIBRARY to use another folder).
setlocal
set "HERE=%~dp0"
if not exist "%HERE%runtime\node\node.exe" ( echo runtime\node\node.exe is missing; re-extract the ZIP. & pause & exit /b 3 )
if "%EIGHTMAX_TEST_CLI%"=="" set "EIGHTMAX_TEST_CLI=%HERE%native\mwcli.exe"
cd /d "%HERE%"
echo Long-duration acceptance. Close other programs first. Results are collected into a ZIP on your Desktop.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File "%HERE%windows\Test-LongDuration.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
if "%NOPAUSE%"=="" pause
exit /b %RC%
