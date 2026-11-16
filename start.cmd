@echo off
setlocal
cd /d "%~dp0"
if not defined OPENCODE_BRIDGE_PORT set OPENCODE_BRIDGE_PORT=8787
if not defined OPENCODE_BRIDGE_DIR set OPENCODE_BRIDGE_DIR=%~dp0scratch
if not defined OPENCODE_BRIDGE_MODEL set OPENCODE_BRIDGE_MODEL=opencode/glm-5.3-flash-free
bun bridge.mjs
