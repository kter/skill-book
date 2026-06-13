#!/usr/bin/env sh
# Offline pre-publish smoke test for @skill-book/cli — runs INSIDE a clean node
# container with NO network access to the API. Proves the published tarball is
# self-contained and that the binary reports the expected version, without
# needing AWS credentials or a live dev API. The full API-backed smoke
# (scripts/cli_smoke_in_container.sh) stays a local `make verify-cli-package` gate.
#
# Required env: EXPECTED_VERSION (the version this tag publishes)
set -eu

: "${EXPECTED_VERSION:?EXPECTED_VERSION is required}"

echo "== install the packaged CLI globally (clean container, zero monorepo deps) =="
npm install -g /tmp/cli.tgz >/dev/null 2>&1
echo "installed: $(command -v skill-book)"

echo
echo "== runtime dependency footprint (expect only @skill-book/cli — bundle is self-contained) =="
npm ls -g --depth=0 2>/dev/null || true

echo
echo "== smoke 0: binary executes and reports the expected version =="
GOT="$(skill-book --version)"
echo "skill-book --version -> $GOT (expected $EXPECTED_VERSION)"
if [ "$GOT" != "$EXPECTED_VERSION" ]; then
  echo "FAIL: --version ($GOT) does not match the published version ($EXPECTED_VERSION)." >&2
  echo "      Bump the hardcoded .version() in packages/cli/src/index.ts to match package.json." >&2
  exit 1
fi

echo
echo "== smoke 1: --help renders without a network call =="
skill-book --help >/dev/null
echo "OK: --help rendered"

echo
echo "ALL OFFLINE CLI PACKAGE SMOKE CHECKS PASSED"
