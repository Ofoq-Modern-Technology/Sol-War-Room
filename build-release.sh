#!/usr/bin/env bash
# Full production release build for SOL_WAR_ROOM
# Usage: bash build-release.sh [--obfuscate] [--pkg]
#
# Output: artifacts/api-server/dist/  (copy & ship this folder)
#
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
OBFUSCATE=false
USE_PKG=false

for arg in "$@"; do
  case $arg in
    --obfuscate) OBFUSCATE=true ;;
    --pkg)       USE_PKG=true ;;
  esac
done

echo ""
echo "  SOL_WAR_ROOM — Release Build"
echo "  ─────────────────────────────"
echo ""

# ── 1. Build frontend ─────────────────────────────────────────────────────────
echo "  [1/3] Building frontend…"
cd "$ROOT/artifacts/sol-war"
BASE_PATH=/ NODE_ENV=production pnpm vite build --config vite.config.ts
echo "        ✓ Frontend built"

# ── 2. Build backend (copies frontend into dist/public) ───────────────────────
echo "  [2/3] Building backend…"
cd "$ROOT/artifacts/api-server"
pnpm run build
echo "        ✓ Backend built"

DIST="$ROOT/artifacts/api-server/dist"

# ── 3. Obfuscate (optional) ───────────────────────────────────────────────────
if [ "$OBFUSCATE" = true ]; then
  echo "  [3/3] Obfuscating server.cjs…"
  if ! command -v javascript-obfuscator &> /dev/null; then
    npm install -g javascript-obfuscator --quiet
  fi
  javascript-obfuscator "$DIST/server.cjs" \
    --output "$DIST/server.cjs" \
    --compact true \
    --string-array true \
    --rotate-string-array true \
    --string-array-encoding base64 \
    --dead-code-injection false \
    --self-defending true \
    --rename-globals false \
    --source-map false
  echo "        ✓ Obfuscated"
else
  echo "  [3/3] Skipping obfuscation (pass --obfuscate to enable)"
fi

# ── Make start script executable ─────────────────────────────────────────────
chmod +x "$DIST/start.sh"

# ── Summary ───────────────────────────────────────────────────────────────────
SIZE=$(du -sh "$DIST" 2>/dev/null | cut -f1)
echo ""
echo "  ✅  Release ready: artifacts/api-server/dist/  ($SIZE)"
echo ""
echo "  Distribute the dist/ folder. Users run:"
echo "    Mac/Linux:  bash start.sh"
echo "    Windows:    start.bat"
echo "    or directly: npm install && node server.cjs"
echo ""
echo "  Environment variables (optional):"
echo "    PORT=8080                  Server port (default 8080)"
echo "    DATABASE_PATH=./my.db      Custom DB location"
echo "    LICENSE_CHECK_ENABLED=1    Enable license gate (disabled by default)"
echo ""
