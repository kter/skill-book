#!/usr/bin/env bash
# Verify the destructive-command guard blocks/permits the right Bash commands.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
guard="$script_dir/claude_pre_tool_use_guard.mjs"

failures=0

expect_blocked() {
  local cmd="$1"
  local out
  out="$(CLAUDE_HOOK_COMMAND="$cmd" node "$guard")"
  if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
    echo "PASS (blocked):   $cmd"
  else
    echo "FAIL (should block): $cmd" >&2
    failures=$((failures + 1))
  fi
}

expect_allowed() {
  local cmd="$1"
  local out
  out="$(CLAUDE_HOOK_COMMAND="$cmd" node "$guard")"
  if [ -z "$out" ]; then
    echo "PASS (allowed):   $cmd"
  else
    echo "FAIL (should allow): $cmd" >&2
    failures=$((failures + 1))
  fi
}

expect_blocked "rm -rf /tmp/foo"
expect_blocked "rm -fr node_modules"
expect_blocked "sudo rm -rf /var"
expect_blocked "bash -c 'rm -rf dist'"
expect_blocked "env FOO=1 rm -rf dist"
expect_blocked "terraform destroy -auto-approve"
expect_blocked "git reset --hard HEAD~1"
expect_blocked "git clean -fd"
expect_blocked "find . -name '*.tmp' -delete"

expect_allowed "rm -r dist"
expect_allowed "rm file.txt"
expect_allowed "terraform plan"
expect_allowed "git reset HEAD~1"
expect_allowed "git clean -n"
expect_allowed "find . -name '*.tmp'"
expect_allowed "echo rm -rf"

if [ "$failures" -gt 0 ]; then
  echo "$failures guard test(s) failed" >&2
  exit 1
fi
echo "All guard tests passed."
