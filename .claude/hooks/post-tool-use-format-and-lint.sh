#!/usr/bin/env bash

set -euo pipefail

project_dir="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
make_bin="${CLAUDE_HOOK_MAKE_BIN:-make}"

payload="$(cat)"
if [ -z "$payload" ]; then
  exit 0
fi

file_path="$(
  printf '%s' "$payload" | node -e '
let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(raw);
    const toolInput = data.tool_input || {};
    process.stdout.write(toolInput.file_path || "");
  } catch {
    /* malformed payload: skip */
  }
});
'
)"

if [ -z "$file_path" ]; then
  exit 0
fi

case "$file_path" in
  "$project_dir"/*)
    rel_path="${file_path#"$project_dir"/}"
    ;;
  *)
    rel_path="$file_path"
    ;;
esac

if [ -z "$rel_path" ]; then
  exit 0
fi

case "$rel_path" in
  ../*|*/../*|..)
    exit 0
    ;;
esac

"$make_bin" -C "$project_dir" --no-print-directory claude-post-tool-use FILE_PATH="$rel_path" >/dev/null 2>&1 || true
