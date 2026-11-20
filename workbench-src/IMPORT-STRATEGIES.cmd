@echo off
rem EightMax Test Workbench 0.35.0 - add strategies from an exported .emslb file (drag the file onto this script). Every record is verified first.
rem Strategy library: %LOCALAPPDATA%\EightMax-Test-Workbench\StrategyLibrary (set EIGHTMAX_STRATEGY_LIBRARY to use another folder).
setlocal
set "HERE=%~dp0"
if not exist "%HERE%runtime\node\node.exe" ( echo runtime\node\node.exe is missing; re-extract the ZIP. & pause & exit /b 3 )
if "%EIGHTMAX_TEST_CLI%"=="" set "EIGHTMAX_TEST_CLI=%HERE%native\mwcli.exe"
cd /d "%HERE%"
set "IN=%~1"
if "%IN%"=="" set /p "IN=Drag the .emslb file into this window and press Enter: "
if "%IN%"=="" ( echo No file given. & pause & exit /b 2 )
set "IN=%IN:"=%"
"%HERE%runtime\node\node.exe" tools\strategy-library.cjs import --in="%IN%"
set "RC=%ERRORLEVEL%"
echo.
if "%NOPAUSE%"=="" pause
exit /b %RC%
