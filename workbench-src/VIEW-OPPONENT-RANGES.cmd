@echo off
rem EightMax Test Workbench 0.35.0 - play simulated hands with opponent ranges derived from the betting and save them for the Opponent ranges panel.
rem Strategy library: %LOCALAPPDATA%\EightMax-Test-Workbench\StrategyLibrary (set EIGHTMAX_STRATEGY_LIBRARY to use another folder).
setlocal
set "HERE=%~dp0"
if not exist "%HERE%runtime\node\node.exe" ( echo runtime\node\node.exe is missing; re-extract the ZIP. & pause & exit /b 3 )
if "%EIGHTMAX_TEST_CLI%"=="" set "EIGHTMAX_TEST_CLI=%HERE%native\mwcli.exe"
cd /d "%HERE%"
echo Playing simulated hands with derived opponent ranges (the first run trains the preflop study once; a few minutes).
"%HERE%runtime\node\node.exe" tools\strategy-library.cjs ranges %*
set "RC=%ERRORLEVEL%"
echo.
if "%NOPAUSE%"=="" pause
exit /b %RC%
