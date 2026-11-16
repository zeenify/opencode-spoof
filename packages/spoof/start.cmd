@echo off
setlocal
cd /d "%~dp0"
if not defined OPENCODE_SPOOF_PORT set OPENCODE_SPOOF_PORT=8788
call bun spoof.mjs
