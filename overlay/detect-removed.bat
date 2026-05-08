@echo off
rem Wrapper for detect-removed.ps1.
rem Run BEFORE update-cpa.bat to scout what upstream is removing.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0detect-removed.ps1" %*
exit /b %ERRORLEVEL%
