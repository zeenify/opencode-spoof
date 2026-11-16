@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   opencode-spoof - one-click setup
echo ============================================
echo.

where bun >nul 2>nul
if errorlevel 1 (
  echo   X  Bun is not installed.
  echo.
  echo   Install it with:   npm install -g bun
  echo   ^(or see https://bun.sh^)
  echo.
  pause
  exit /b 1
)

if not exist "packages\spoof\agent-prompt.json" (
  echo   X  agent-prompt.json is missing from this folder.
  echo      Re-download the repository.
  pause
  exit /b 1
)

bun "packages\spoof\setup-check.mjs"
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

echo ============================================
echo   Setting:  Base URL  http://127.0.0.1:8788/v1
echo             API key   anything
echo             Model     glm-5.3-flash-free
echo   Keep this window open while you use it.
echo ============================================
echo.

if not defined OPENCODE_SPOOF_PORT set OPENCODE_SPOOF_PORT=8788
bun "packages\spoof\spoof.mjs"
pause
