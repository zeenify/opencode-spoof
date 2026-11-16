@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   opencode-spoof - refresh model catalog
echo ============================================
echo.

where bun >nul 2>nul
if errorlevel 1 (
  echo   X  Bun is not installed.
  echo      Install it with:  npm install -g bun
  echo.
  pause
  exit /b 1
)

call bun "packages\bridge\refresh-models.mjs"
if errorlevel 1 (
  echo.
  echo   Could not build the catalog.
  echo   Make sure opencode is installed and signed in, then try again.
  echo.
  pause
  exit /b 1
)

echo.
if exist "models.md" (
  echo Opening models.md
  start "" "models.md"
) else (
  echo models.md was not created.
)
echo.
pause
