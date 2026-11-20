@echo off
rem EightMax Test Workbench 0.35.0 - eight-handed preflop research (Fast Reference Study by default; pass --mode=standard or --mode=high-accuracy).
rem Strategy library: %LOCALAPPDATA%\EightMax-Test-Workbench\StrategyLibrary (set EIGHTMAX_STRATEGY_LIBRARY to use another folder).
setlocal
set "HERE=%~dp0"
if not exist "%HERE%runtime\node\node.exe" ( echo runtime\node\node.exe is missing; re-extract the ZIP. & pause & exit /b 3 )
if "%EIGHTMAX_TEST_CLI%"=="" set "EIGHTMAX_TEST_CLI=%HERE%native\mwcli.exe"
cd /d "%HERE%"
echo Preflop research: coverage, range support, first-in deviation gains. Results: Research panel in the dashboard.
"%HERE%runtime\node\node.exe" tools\preflop-research-032.cjs --mode=fast --updates=200000 --seeds=8 --deviations --deviationSamples=500 --cache="%LOCALAPPDATA%\EightMax-Test-Workbench\PreflopStudies" --out="%LOCALAPPDATA%\EightMax-Test-Workbench\preflop-research-latest.json" %*
set "RC=%ERRORLEVEL%"
echo.
if "%NOPAUSE%"=="" pause
exit /b %RC%
