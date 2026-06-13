#!/usr/bin/env sh
# Pre-publish smoke test for @skill-book/cli — runs INSIDE a clean node container.
# The host filesystem (notably ~/.claude) is never touched; all installs land in
# the container's own HOME and are discarded when the container exits.
#
# Required env: API_URL, BYPASS_TOKEN
set -eu

echo "== install the packaged CLI globally (clean container, zero monorepo deps) =="
npm install -g /tmp/cli.tgz >/dev/null 2>&1
echo "installed: $(command -v skill-book)"

echo
echo "== runtime dependency footprint (expect only @skill-book/cli — bundle is self-contained) =="
npm ls -g --depth=0 2>/dev/null || true

echo
echo "== smoke 0: binary executes =="
skill-book --version

echo
echo "== smoke 1: AUTHZ boundary — an invalid token must be rejected by the server =="
if SKILL_BOOK_API_URL="$API_URL" SKILL_BOOK_BYPASS_TOKEN="definitely-not-a-valid-token" \
    skill-book search >/tmp/o 2>&1; then
  echo "FAIL: the server accepted an invalid token"; cat /tmp/o; exit 1
fi
echo "OK: invalid token rejected by the API"

echo
echo "== smoke 2: AUTHN boundary — no credentials must fail =="
if SKILL_BOOK_API_URL="$API_URL" skill-book search >/tmp/o 2>&1; then
  echo "FAIL: unauthenticated search succeeded"; cat /tmp/o; exit 1
fi
echo "OK: unauthenticated search refused"

echo
echo "== smoke 3: authenticated whoami (bypass token) =="
SKILL_BOOK_API_URL="$API_URL" SKILL_BOOK_BYPASS_TOKEN="$BYPASS_TOKEN" skill-book whoami

echo
echo "== smoke 4: authenticated search =="
SKILL_BOOK_API_URL="$API_URL" SKILL_BOOK_BYPASS_TOKEN="$BYPASS_TOKEN" skill-book search | tee /tmp/list

echo
echo "== smoke 5: install round-trip into the container HOME (best-effort) =="
# Skip the header row (line 1: "NAME TYPE ...") and take the first data row.
# When there are no results the only line is "No artifacts found." (no header),
# so NR>1 never matches and NAME stays empty -> the round-trip is skipped.
NAME="$(awk 'NR>1 {print $1; exit}' /tmp/list)"
if [ -n "${NAME:-}" ]; then
  echo "-- target artifact: $NAME"
  echo "-- dry run (no writes) --"
  SKILL_BOOK_API_URL="$API_URL" SKILL_BOOK_BYPASS_TOKEN="$BYPASS_TOKEN" skill-book install "$NAME" --dry-run
  echo "-- real install into \$HOME --"
  SKILL_BOOK_API_URL="$API_URL" SKILL_BOOK_BYPASS_TOKEN="$BYPASS_TOKEN" skill-book install "$NAME"
  echo "-- overwrite refusal without --force (expect failure) --"
  if SKILL_BOOK_API_URL="$API_URL" SKILL_BOOK_BYPASS_TOKEN="$BYPASS_TOKEN" \
      skill-book install "$NAME" >/tmp/o 2>&1; then
    echo "FAIL: re-install overwrote existing files without --force"; cat /tmp/o; exit 1
  fi
  echo "OK: existing files preserved (use --force to overwrite)"
  echo "-- installed skills under \$HOME --"
  ls -la "$HOME/.claude/skills" 2>/dev/null || true
else
  echo "(no artifacts available at $API_URL — skipping install round-trip)"
fi

echo
echo "ALL CLI PACKAGE SMOKE CHECKS PASSED"
