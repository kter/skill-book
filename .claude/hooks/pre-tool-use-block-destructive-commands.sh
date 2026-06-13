#!/usr/bin/env bash

set -euo pipefail

project_dir="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
make_bin="${CLAUDE_HOOK_MAKE_BIN:-make}"

payload="$(cat)"
if [ -z "$payload" ]; then
  exit 0
fi

command="$(
  printf '%s' "$payload" | node -e '
let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(raw);
    const toolInput = data.tool_input || {};
    process.stdout.write(toolInput.command || "");
  } catch {
    /* malformed payload: allow */
  }
});
'
)"

if [ -z "$command" ]; then
  exit 0
fi

CLAUDE_HOOK_COMMAND="$command" \
  "$make_bin" -C "$project_dir" --no-print-directory claude-pre-tool-use
