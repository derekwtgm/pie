@echo off
rem EightMax 4.8 checks (no PowerShell needed): golden training state, the 4.5 continuation
rem sequence (150 updates, deadline-limited evaluation, 150 more = 300), the repaired four-player
rem continuation fixture, 4.8 response-evaluation results equal to the 4.7 evaluation path,
rem evaluation deadlines, checkpoint comparison classes and compressed checkpoints.
rem Writes EightMax-4.8-self-test.json.
cd /d "%~dp0"
echo Checking the EightMax 4.8 changes. This takes about a minute.
set "eightmax_work=%TEMP%\EightMax-4.8-checks"
if exist "%eightmax_work%" rmdir /s /q "%eightmax_work%"
"%~dp0mwcli.exe" --selftest48 "%~dp0validation\4.8\fixtures" "%eightmax_work%"
set "eightmax_48_result=%errorlevel%"
if exist "%eightmax_work%\selftest48.json" copy /y "%eightmax_work%\selftest48.json" "%~dp0EightMax-4.8-self-test.json" >nul
echo.
if "%eightmax_48_result%"=="0" (echo All 4.8 checks passed. Report: EightMax-4.8-self-test.json) else (echo A 4.8 check failed. Please keep EightMax-4.8-self-test.json and the folder %eightmax_work%.)
if /i not "%~1"=="/nopause" pause
exit /b %eightmax_48_result%
