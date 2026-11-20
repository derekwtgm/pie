@echo off
rem EightMax Test Workbench 0.35.0 - export the whole strategy library into one file on your Desktop.
rem Strategy library: %LOCALAPPDATA%\EightMax-Test-Workbench\StrategyLibrary (set EIGHTMAX_STRATEGY_LIBRARY to use another folder).
setlocal
set "HERE=%~dp0"
if not exist "%HERE%runtime\node\node.exe" ( echo runtime\node\node.exe is missing; re-extract the ZIP. & pause & exit /b 3 )
if "%EIGHTMAX_TEST_CLI%"=="" set "EIGHTMAX_TEST_CLI=%HERE%native\mwcli.exe"
cd /d "%HERE%"
for /f "tokens=1-3 delims=/-. " %%a in ("%date%") do set "D=%%a%%b%%c"
"%HERE%runtime\node\node.exe" tools\strategy-library.cjs export --out="%USERPROFILE%\Desktop\EightMax-Strategies-%D%.emslb" %*
set "RC=%ERRORLEVEL%"
echo.
if "%NOPAUSE%"=="" pause
exit /b %RC%
