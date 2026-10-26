@echo off
setlocal
cd /d "%~dp0"
where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo Windows PowerShell was not found.
  echo You can also run: node scripts\serve.mjs --open
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\serve.ps1"
if errorlevel 1 (
  echo.
  echo Miniroom could not start. Read the message above for details.
  pause
)
