@echo off
rem 0.35.0 (from 0.27): run one of the workbench's Node.js development / QA tools with the BUNDLED Node.js (runtime\node\node.exe) - no Node.js installation needed.
rem   RUN-TOOL.cmd tools\full-hand-scenario.cjs --hands=20 --seed=2024 --out=reports\my-scenario.json
rem Never run on Windows by any build.
setlocal
set "HERE=%~dp0"
if "%~1"=="" ( echo Usage: RUN-TOOL.cmd tools\script.cjs [options] & echo Tools: & dir /b "%HERE%tools\*.cjs" & exit /b 2 )
if not exist "%HERE%runtime\node\node.exe" ( echo runtime\node\node.exe is missing; re-extract the ZIP. & exit /b 3 )
if not exist "%HERE%native\mwcli.exe" ( echo native\mwcli.exe is missing; re-extract the ZIP. & exit /b 3 )
if "%EIGHTMAX_TEST_CLI%"=="" set "EIGHTMAX_TEST_CLI=%HERE%native\mwcli.exe"
cd /d "%HERE%"
"%HERE%runtime\node\node.exe" %*
exit /b %ERRORLEVEL%
