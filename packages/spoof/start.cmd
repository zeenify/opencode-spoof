@echo off
setlocal
cd /d "%~dp0"
if not defined OPENCODE_SPOOF_PORT set OPENCODE_SPOOF_PORT=8788

netstat -ano | findstr ":%OPENCODE_SPOOF_PORT%" | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo.
  echo   Port %OPENCODE_SPOOF_PORT% is already in use.
  echo   opencode-spoof is probably already running - you can use it as is.
  echo.
  echo   If you want to restart it, close the other window or run:
  echo       taskkill /F /IM bun.exe
  echo.
  pause
  exit /b 1
)

echo Starting opencode-spoof on http://127.0.0.1:%OPENCODE_SPOOF_PORT%/v1
echo Keep this window open. Press Ctrl+C to stop.
echo.
call bun spoof.mjs
echo.
echo The proxy stopped.
pause
