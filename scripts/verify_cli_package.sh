#!/usr/bin/env bash
# Pre-publish verification for @skill-book/cli.
#
# Builds and packs the EXACT tarball that `npm publish` would upload, prints its
# contents for inspection, then installs and exercises it inside a throwaway
# Docker container. Running in a container guarantees two things:
#   1. the host filesystem (~/.claude) is never modified, and
#   2. the bundle is proven self-contained — a clean environment with no monorepo
#      node_modules either runs the CLI or fails loudly.
#
# Required env: API_URL, BYPASS_TOKEN (supplied by `make verify-cli-package`).
set -euo pipefail

: "${API_URL:?API_URL is required (run via: make verify-cli-package ENV=dev)}"
: "${BYPASS_TOKEN:?BYPASS_TOKEN is required (run via: make verify-cli-package ENV=dev)}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACK_DIR="$(mktemp -d)"
trap 'rm -rf "$PACK_DIR"' EXIT

echo "== building shared (bundled into the CLI) =="
npm run build --workspace packages/shared >/dev/null

echo "== npm pack (prepack rebuilds dist/) =="
TARBALL="$(cd "$PACK_DIR" && npm pack "$ROOT/packages/cli" 2>/dev/null | grep -E '\.tgz$' | tail -n1)"
if [ -z "${TARBALL:-}" ]; then
  echo "FAIL: npm pack produced no tarball" >&2
  exit 1
fi
echo "packed: $PACK_DIR/$TARBALL"

echo
echo "== published tarball contents =="
tar -tzf "$PACK_DIR/$TARBALL"

echo
echo "== smoke in a clean node:24-alpine container =="
docker run --rm \
  -e API_URL="$API_URL" \
  -e BYPASS_TOKEN="$BYPASS_TOKEN" \
  -v "$PACK_DIR/$TARBALL:/tmp/cli.tgz:ro" \
  -v "$ROOT/scripts/cli_smoke_in_container.sh:/tmp/smoke.sh:ro" \
  node:24-alpine sh /tmp/smoke.sh
