@echo off
rem EightMax Test Workbench 0.35.0 - same as RUN-TOOL.cmd (kept from 0.28 so either name works).
call "%~dp0RUN-TOOL.cmd" %*
exit /b %ERRORLEVEL%
