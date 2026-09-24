@echo off
REM Goal Guru - Development Server Launcher
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
endlocal
