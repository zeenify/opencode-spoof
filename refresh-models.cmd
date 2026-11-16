@echo off
setlocal
cd /d "%~dp0"
if not defined OPENCODE_BRIDGE_PORT set OPENCODE_BRIDGE_PORT=8787
echo Refreshing model catalog...
curl -s -X POST "http://127.0.0.1:%OPENCODE_BRIDGE_PORT%/v1/models/refresh"
echo.
if exist "%~dp0models.md" (
  echo Opening models.md
  start "" "%~dp0models.md"
) else (
  echo models.md was not created. Is the bridge running?
)
