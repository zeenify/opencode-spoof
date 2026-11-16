#!/usr/bin/env sh
# opencode-spoof setup for macOS / Linux
cd "$(dirname "$0")" || exit 1

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is not installed."
  echo "Install it with:  curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

bun setup-check.mjs || exit 1

echo "============================================"
echo "  Base URL  http://127.0.0.1:8788/v1"
echo "  API key   anything"
echo "  Model     glm-5.3-flash-free"
echo "  Keep this terminal open while you use it."
echo "============================================"
echo

OPENCODE_SPOOF_PORT="${OPENCODE_SPOOF_PORT:-8788}" exec bun spoof.mjs
