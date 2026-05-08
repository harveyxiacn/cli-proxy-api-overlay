#!/bin/bash
# =============================================================================
#  build.sh  —  full build (frontend + Linux Go binary)
#
#  Cross-compiles for Linux amd64 with -tags embed_frontend so the resulting
#  single binary serves the React SPA + all overlay endpoints. Run from
#  anywhere; this script jumps to project root by walking up two levels.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

echo "============================================"
echo " CPA Full Build (Frontend + Linux Binary)"
echo " project root: $ROOT"
echo "============================================"

echo ""
echo "[1/4] Installing frontend dependencies..."
( cd frontend && pnpm install )

echo ""
echo "[2/4] Building React frontend..."
( cd frontend && pnpm run build )

echo ""
echo "[3/4] Copying frontend dist to Go embed directory..."
rm -rf CLIProxyAPI/internal/api/frontend_dist
cp -r frontend/dist CLIProxyAPI/internal/api/frontend_dist

echo ""
echo "[4/4] Building Go binary with embedded frontend..."

# Inject version identity from git (silent if no git)
VERSION="$(git -C CLIProxyAPI describe --tags --always 2>/dev/null || echo dev)"
COMMIT="$(git -C CLIProxyAPI rev-parse --short HEAD 2>/dev/null || echo none)"
BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

(
  cd CLIProxyAPI
  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -tags embed_frontend \
      -ldflags="-s -w -X main.Version=${VERSION}-overlay -X main.Commit=${COMMIT} -X main.BuildDate=${BUILD_DATE}" \
      -o ../cli-proxy-api-linux ./cmd/server/
)

echo ""
echo "============================================"
echo " Build complete: cli-proxy-api-linux"
echo " Version: ${VERSION}-overlay (${COMMIT})"
echo " Management UI: http://127.0.0.1:8317/cpa-management"
echo "============================================"
