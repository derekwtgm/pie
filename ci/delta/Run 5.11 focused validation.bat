@echo off
setlocal
cd /d "%~dp0"
echo EightMax 5.11 focused validation on this Windows PC: what 5.11 added or changed in the trainer.
echo   - the counter-based 64-bit training streams: the generator against its reference vectors and its inverse,
echo     and a counter audit of real trainings (no counter is handed to the generator twice)
echo   - "trainingStreams" 5.11: the states of 5.11, byte for byte, with 1, 2, 4, 8 and all logical processors
echo   - philox64: one state for every thread count and processing mode, the state of the Linux build;
echo     stop and continue; checkpoint rules; a 64-bit seed
echo   - the 10,000,000-update limit: kept by 5.11 states, absent for philox64 states (trained past it here)
echo   - reference fixtures: exact NashConv after a fixed budget; the trained response of a philox64 state
echo No GPU test. Nothing is installed. This takes about 5 to 12 minutes.
echo Saved studies are not touched: everything is written to a temporary folder, which is removed at the end.
echo Reports are written into this folder:
echo   Windows-selftest511-5.11.json          the checks made by mwcli.exe itself (no PowerShell needed)
echo   Windows-focused-validation-5.11.json   every check, with its status and its evidence
echo   Windows-focused-validation-5.11.txt    the same as text
echo.
rem Reports of an earlier run are removed first, so that a file found afterwards was written by this run.
if exist "Windows-selftest511-5.11.json" del /q "Windows-selftest511-5.11.json"
if exist "Windows-focused-validation-5.11.json" del /q "Windows-focused-validation-5.11.json"
if exist "Windows-focused-validation-5.11.txt" del /q "Windows-focused-validation-5.11.txt"
echo Step 1 of 2: mwcli.exe --selftest511
set "em_st=%TEMP%\EightMax-5.11-selftest511-%RANDOM%%RANDOM%"
mwcli.exe --selftest511 "studies" "%em_st%" all
set "selftest_result=%errorlevel%"
if exist "%em_st%\selftest511.json" copy /y "%em_st%\selftest511.json" "Windows-selftest511-5.11.json" >nul
if exist "%em_st%" rmdir /s /q "%em_st%"
if "%selftest_result%"=="0" (echo Self-test 5.11: every check passed.) else (echo Self-test 5.11: exit status %selftest_result%: a check failed or could not be made. See Windows-selftest511-5.11.json.)
rem A self-test that ends with status 0 but wrote no report has not shown anything: that is not a pass.
if not exist "Windows-selftest511-5.11.json" if "%selftest_result%"=="0" set "selftest_result=2"
if not exist "Windows-selftest511-5.11.json" echo NOTE: Windows-selftest511-5.11.json was not written.
echo.
echo Step 2 of 2: the validation script, focused mode
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "source\tools\validate_windows511.ps1" -Focused %*
set "eightmax_result=%errorlevel%"
rem A script that ends with status 0 but wrote no report has not validated anything: that is not a pass.
if not exist "Windows-focused-validation-5.11.json" if "%eightmax_result%"=="0" set "eightmax_result=2"
echo.
if "%eightmax_result%"=="0" echo Every required check of the script passed.
if "%eightmax_result%"=="1" echo At least one required check failed or could not be made. Please keep the report files.
if not "%eightmax_result%"=="0" if not "%eightmax_result%"=="1" echo The validation script itself did not finish ^(exit status %eightmax_result%^). Its 5.11 sections have not run on a physical Windows PC before this release; please keep the report files and the text above. The self-test result of step 1 stands on its own.
if not exist "Windows-focused-validation-5.11.json" echo NOTE: Windows-focused-validation-5.11.json was not written, so nothing of the script is counted as passed.
if not "%selftest_result%"=="0" if "%eightmax_result%"=="0" set "eightmax_result=1"
echo Overall exit status: %eightmax_result% ^(0 = every required check passed^)
if not defined EIGHTMAX_NO_PAUSE pause
exit /b %eightmax_result%
