@echo off
rem EightMax Test Workbench 0.35.0 - benchmark the exact heads-up turn solver (quality and run time on several configurations).
rem Strategy library: %LOCALAPPDATA%\EightMax-Test-Workbench\StrategyLibrary (set EIGHTMAX_STRATEGY_LIBRARY to use another folder).
setlocal
set "HERE=%~dp0"
if not exist "%HERE%runtime\node\node.exe" ( echo runtime\node\node.exe is missing; re-extract the ZIP. & pause & exit /b 3 )
if "%EIGHTMAX_TEST_CLI%"=="" set "EIGHTMAX_TEST_CLI=%HERE%native\mwcli.exe"
cd /d "%HERE%"
echo Turn solver check (about 5-15 minutes). Results: Research panel in the dashboard.
"%HERE%runtime\node\node.exe" tools\turn-solver-benchmark-032.cjs --quick --maxMs=30000 --out="%LOCALAPPDATA%\EightMax-Test-Workbench\turn-solver-latest.json" %*
set "RC=%ERRORLEVEL%"
echo.
if "%NOPAUSE%"=="" pause
exit /b %RC%
