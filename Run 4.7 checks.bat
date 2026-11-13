@echo off
rem EightMax 4.7 feature checks (no PowerShell needed): golden training state, compressed
rem checkpoints (round trip, resume, corruption), own-hand enumeration continuation, strategy
rem verification, checkpoint comparison and quality monitoring. Writes EightMax-4.7-self-test.json.
cd /d "%~dp0"
echo Checking the EightMax 4.7 features. This takes about a minute.
set "eightmax_work=%TEMP%\EightMax-4.7-checks"
if exist "%eightmax_work%" rmdir /s /q "%eightmax_work%"
"%~dp0mwcli.exe" --selftest47 "%~dp0validation\4.7\fixtures" "%eightmax_work%"
set "eightmax_47_result=%errorlevel%"
if exist "%eightmax_work%\selftest47.json" copy /y "%eightmax_work%\selftest47.json" "%~dp0EightMax-4.7-self-test.json" >nul
echo.
if "%eightmax_47_result%"=="0" (echo All 4.7 checks passed. Report: EightMax-4.7-self-test.json) else (echo A 4.7 check failed. Please keep EightMax-4.7-self-test.json and the folder %eightmax_work%.)
if /i not "%~1"=="/nopause" pause
exit /b %eightmax_47_result%
