@echo off
rem EightMax 4.9 checks (no PowerShell needed): compressed-checkpoint (EMZ1) restoration: default, missing,
rem Unicode and long temporary folders, corrupted files, concurrent restores, 500+500 and
rem 1000+1000 continuations, three compressed generations.
rem (4.8 on a standard Windows account could not resume from a compressed checkpoint.)
rem Writes EightMax-4.9-self-test.json.
cd /d "%~dp0"
echo Checking the EightMax 4.9 changes. This takes under a minute.
set "eightmax_work=%TEMP%\EightMax-4.9-checks"
if exist "%eightmax_work%" rmdir /s /q "%eightmax_work%"
"%~dp0mwcli.exe" --selftest49 "%~dp0validation\4.9\fixtures" "%eightmax_work%"
set "eightmax_48_result=%errorlevel%"
if exist "%eightmax_work%\selftest49.json" copy /y "%eightmax_work%\selftest49.json" "%~dp0EightMax-4.9-self-test.json" >nul
echo.
if "%eightmax_48_result%"=="0" (echo All 4.9 checks passed. Report: EightMax-4.9-self-test.json) else (echo A 4.9 check failed. Please keep EightMax-4.9-self-test.json and the folder %eightmax_work%.)
if /i not "%~1"=="/nopause" pause
exit /b %eightmax_48_result%
