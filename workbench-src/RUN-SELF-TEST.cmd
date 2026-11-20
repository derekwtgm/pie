@echo off
rem EightMax Test Workbench 0.35.0 - quick self-test of the strategy, range, quality, linked-study, turn-solver, approximation and shared-preflop components with the bundled Node.js (a few minutes).
rem Strategy library: %LOCALAPPDATA%\EightMax-Test-Workbench\StrategyLibrary (set EIGHTMAX_STRATEGY_LIBRARY to use another folder).
setlocal
set "HERE=%~dp0"
if not exist "%HERE%runtime\node\node.exe" ( echo runtime\node\node.exe is missing; re-extract the ZIP. & pause & exit /b 3 )
if "%EIGHTMAX_TEST_CLI%"=="" set "EIGHTMAX_TEST_CLI=%HERE%native\mwcli.exe"
cd /d "%HERE%"
echo Running the self-test. A summary appears at the end.
"%HERE%runtime\node\node.exe" --test --test-concurrency=2 tests\range-engine-031.test.cjs tests\quality-031.test.cjs tests\library-031.test.cjs tests\abstraction-031.test.cjs tests\strategy-library-030.test.cjs tests\precompute-030.test.cjs tests\multistreet-032.test.cjs tests\linked-032.test.cjs tests\approx-032.test.cjs tests\preflop-032.test.cjs tests\release-032.test.cjs
set "RC=%ERRORLEVEL%"
echo.
if "%NOPAUSE%"=="" pause
exit /b %RC%
