@echo off
setlocal
cd /d "%~dp0"
if not defined OPENCODE_BRIDGE_PORT set OPENCODE_BRIDGE_PORT=8787
if not defined OPENCODE_BRIDGE_DIR set OPENCODE_BRIDGE_DIR=%~dp0scratch
if not defined OPENCODE_BRIDGE_MODEL set OPENCODE_BRIDGE_MODEL=opencode/glm-5.3-flash-free

netstat -ano | findstr ":%OPENCODE_BRIDGE_PORT%" | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo.
  echo   Port %OPENCODE_BRIDGE_PORT% is already in use.
  echo   The bridge is probably already running - you can use it as is.
  echo.
  pause
  exit /b 1
)

echo Starting opencode bridge on http://127.0.0.1:%OPENCODE_BRIDGE_PORT%/v1
echo Keep this window open. Press Ctrl+C to stop.
echo.
call bun bridge.mjs
echo.
echo The bridge stopped.
pause
