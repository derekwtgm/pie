@echo off
setlocal
cd /d "%~dp0"
echo EightMax 5.11 validation on this Windows PC. Nothing is installed. This takes 30 to 80 minutes.
echo Reports are written into this folder:
echo   Windows-selftest-5.11.json        the 5.7 checks made by mwcli.exe itself (no PowerShell needed)
echo   Windows-selftest571-5.11.json     the checkpoint and memory checks made by mwcli.exe itself (no PowerShell needed)
echo   Windows-selftest58-5.11.json      the 5.8 checks made by mwcli.exe itself (no PowerShell needed)
echo   Windows-selftest59-5.11.json      the 5.9 checks made by mwcli.exe itself (no PowerShell needed)
echo   Windows-selftest510-5.11.json     the 5.10 checks made by mwcli.exe itself (no PowerShell needed)
echo   Windows-selftest511-5.11.json     the 5.11 checks made by mwcli.exe itself (no PowerShell needed)
echo   Windows-validation-5.11.json      every check, with its status: passed, failed, skipped or untested
echo   Windows-validation-5.11.txt       the same as text
echo   hardware-validation.json         written by the GPU section when an NVIDIA GPU answers
echo.
rem Reports of an earlier run are removed first, so that a file found afterwards was written by this run.
if exist "Windows-selftest-5.11.json" del /q "Windows-selftest-5.11.json"
if exist "Windows-selftest571-5.11.json" del /q "Windows-selftest571-5.11.json"
if exist "Windows-selftest58-5.11.json" del /q "Windows-selftest58-5.11.json"
if exist "Windows-selftest59-5.11.json" del /q "Windows-selftest59-5.11.json"
if exist "Windows-selftest510-5.11.json" del /q "Windows-selftest510-5.11.json"
if exist "Windows-selftest511-5.11.json" del /q "Windows-selftest511-5.11.json"
if exist "Windows-validation-5.11.json" del /q "Windows-validation-5.11.json"
if exist "Windows-validation-5.11.txt" del /q "Windows-validation-5.11.txt"
echo Step 1 of 7: mwcli.exe --selftest57
set "em_st=%TEMP%\EightMax-5.11-selftest-%RANDOM%%RANDOM%"
mwcli.exe --selftest57 "validation\5.7\fixtures" "%em_st%"
set "selftest_result=%errorlevel%"
if exist "%em_st%\selftest57.json" copy /y "%em_st%\selftest57.json" "Windows-selftest-5.11.json" >nul
if exist "%em_st%" rmdir /s /q "%em_st%"
if "%selftest_result%"=="0" (echo Self-test 5.7: every check passed.) else (echo Self-test 5.7: exit status %selftest_result%. See Windows-selftest-5.11.json.)
if not exist "Windows-selftest-5.11.json" if "%selftest_result%"=="0" set "selftest_result=2"
echo.
echo Step 2 of 7: mwcli.exe --selftest571 (checkpoint integrity and the process memory budget)
set "em_st2=%TEMP%\EightMax-5.11-selftest571-%RANDOM%%RANDOM%"
mwcli.exe --selftest571 "studies" "%em_st2%" all
set "selftest571_result=%errorlevel%"
if exist "%em_st2%\selftest571.json" copy /y "%em_st2%\selftest571.json" "Windows-selftest571-5.11.json" >nul
if exist "%em_st2%" rmdir /s /q "%em_st2%"
if "%selftest571_result%"=="0" (echo Self-test 5.7.1: every check passed.) else (echo Self-test 5.7.1: exit status %selftest571_result%: a check failed or could not be made. See Windows-selftest571-5.11.json.)
if not exist "Windows-selftest571-5.11.json" if "%selftest571_result%"=="0" set "selftest571_result=2"
echo.
echo Step 3 of 7: mwcli.exe --selftest58 (trained response, large-study limit, ICM cache)
set "em_st3=%TEMP%\EightMax-5.11-selftest58-%RANDOM%%RANDOM%"
mwcli.exe --selftest58 "studies" "%em_st3%" all
set "selftest58_result=%errorlevel%"
if exist "%em_st3%\selftest58.json" copy /y "%em_st3%\selftest58.json" "Windows-selftest58-5.11.json" >nul
if exist "%em_st3%" rmdir /s /q "%em_st3%"
if "%selftest58_result%"=="0" (echo Self-test 5.8: every check passed.) else (echo Self-test 5.8: exit status %selftest58_result%: a check failed or could not be made. See Windows-selftest58-5.11.json.)
if not exist "Windows-selftest58-5.11.json" if "%selftest58_result%"=="0" set "selftest58_result=2"
echo.
echo Step 4 of 7: mwcli.exe --selftest59 (confidence statements, evaluation random streams, the response summary against exact values)
set "em_st4=%TEMP%\EightMax-5.11-selftest59-%RANDOM%%RANDOM%"
mwcli.exe --selftest59 "studies" "%em_st4%" all
set "selftest59_result=%errorlevel%"
if exist "%em_st4%\selftest59.json" copy /y "%em_st4%\selftest59.json" "Windows-selftest59-5.11.json" >nul
if exist "%em_st4%" rmdir /s /q "%em_st4%"
if "%selftest59_result%"=="0" (echo Self-test 5.9: every check passed.) else (echo Self-test 5.9: exit status %selftest59_result%: a check failed or could not be made. See Windows-selftest59-5.11.json.)
if not exist "Windows-selftest59-5.11.json" if "%selftest59_result%"=="0" set "selftest59_result=2"
echo.
echo Step 5 of 7: mwcli.exe --selftest510 (the experimental estimator against exact targets, both trainers against recorded states, checkpoint rules, limits)
set "em_st5=%TEMP%\EightMax-5.11-selftest510-%RANDOM%%RANDOM%"
mwcli.exe --selftest510 "studies" "%em_st5%" all
set "selftest510_result=%errorlevel%"
if exist "%em_st5%\selftest510.json" copy /y "%em_st5%\selftest510.json" "Windows-selftest510-5.11.json" >nul
if exist "%em_st5%" rmdir /s /q "%em_st5%"
if "%selftest510_result%"=="0" (echo Self-test 5.10: every check passed.) else (echo Self-test 5.10: exit status %selftest510_result%: a check failed or could not be made. See Windows-selftest510-5.11.json.)
if not exist "Windows-selftest510-5.11.json" if "%selftest510_result%"=="0" set "selftest510_result=2"
echo.
echo Step 6 of 7: mwcli.exe --selftest511 (the counter-based training streams: generator, counter audit, recorded states, checkpoint rules, the update limit)
set "em_st6=%TEMP%\EightMax-5.11-selftest511-%RANDOM%%RANDOM%"
mwcli.exe --selftest511 "studies" "%em_st6%" all
set "selftest511_result=%errorlevel%"
if exist "%em_st6%\selftest511.json" copy /y "%em_st6%\selftest511.json" "Windows-selftest511-5.11.json" >nul
if exist "%em_st6%" rmdir /s /q "%em_st6%"
if "%selftest511_result%"=="0" (echo Self-test 5.11: every check passed.) else (echo Self-test 5.11: exit status %selftest511_result%: a check failed or could not be made. See Windows-selftest511-5.11.json.)
if not exist "Windows-selftest511-5.11.json" if "%selftest511_result%"=="0" set "selftest511_result=2"
echo.
echo Step 7 of 7: the validation script
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "source\tools\validate_windows511.ps1" %*
set "eightmax_result=%errorlevel%"
rem A script that ends with status 0 but wrote no report has not validated anything: that is not a pass.
if not exist "Windows-validation-5.11.json" if "%eightmax_result%"=="0" set "eightmax_result=2"
echo.
if "%eightmax_result%"=="0" echo Every required check of the script passed. Skipped checks, if any, are listed above with their reason.
if "%eightmax_result%"=="1" echo At least one required check failed or could not be made. Please keep the report files.
if not "%eightmax_result%"=="0" if not "%eightmax_result%"=="1" echo The validation script itself did not finish ^(exit status %eightmax_result%^). Its 5.11 sections have not run on a physical Windows PC before this release; please keep the report files and the text above. The self-test results of steps 1 to 6 stand on their own.
if not exist "Windows-validation-5.11.json" echo NOTE: Windows-validation-5.11.json was not written, so nothing of the script is counted as passed.
if not "%selftest_result%"=="0" if "%eightmax_result%"=="0" set "eightmax_result=1"
if not "%selftest571_result%"=="0" if "%eightmax_result%"=="0" set "eightmax_result=1"
if not "%selftest58_result%"=="0" if "%eightmax_result%"=="0" set "eightmax_result=1"
if not "%selftest59_result%"=="0" if "%eightmax_result%"=="0" set "eightmax_result=1"
if not "%selftest510_result%"=="0" if "%eightmax_result%"=="0" set "eightmax_result=1"
if not "%selftest511_result%"=="0" if "%eightmax_result%"=="0" set "eightmax_result=1"
echo Overall exit status: %eightmax_result% ^(0 = every required check passed^)
if not defined EIGHTMAX_NO_PAUSE pause
exit /b %eightmax_result%
