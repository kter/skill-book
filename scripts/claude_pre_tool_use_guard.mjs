#!/usr/bin/env node
// Node port of notes' claude_pre_tool_use_guard.py — blocks destructive
// Bash commands issued by Claude Code (rm -rf, terraform destroy, etc.).

const SHELL_WRAPPERS = new Set(["bash", "sh", "zsh"]);
const SHELL_EXEC_FLAGS = new Set(["-c", "-lc", "-ic", "-ec", "-lec", "-xc", "-exc"]);
const PREFIX_WRAPPERS = new Set(["command", "builtin", "nohup"]);

function isEnvAssignment(token) {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*$/.test(token);
}

// Minimal POSIX-ish shlex.split. Returns [] on unbalanced quotes (matches the
// Python guard's behaviour of treating unparseable commands as non-blocking).
export function parseCommand(command) {
  const tokens = [];
  let current = "";
  let hasCurrent = false;
  let i = 0;
  const n = command.length;
  while (i < n) {
    const ch = command[i];
    if (ch === " " || ch === "\t" || ch === "\n") {
      if (hasCurrent) {
        tokens.push(current);
        current = "";
        hasCurrent = false;
      }
      i += 1;
    } else if (ch === "'") {
      const end = command.indexOf("'", i + 1);
      if (end === -1) return [];
      current += command.slice(i + 1, end);
      hasCurrent = true;
      i = end + 1;
    } else if (ch === '"') {
      let j = i + 1;
      let buf = "";
      let closed = false;
      while (j < n) {
        const c = command[j];
        if (c === "\\" && j + 1 < n && ['"', "\\", "$", "`"].includes(command[j + 1])) {
          buf += command[j + 1];
          j += 2;
        } else if (c === '"') {
          closed = true;
          j += 1;
          break;
        } else {
          buf += c;
          j += 1;
        }
      }
      if (!closed) return [];
      current += buf;
      hasCurrent = true;
      i = j;
    } else if (ch === "\\" && i + 1 < n) {
      current += command[i + 1];
      hasCurrent = true;
      i += 2;
    } else {
      current += ch;
      hasCurrent = true;
      i += 1;
    }
  }
  if (hasCurrent) tokens.push(current);
  return tokens;
}

export function stripWrappers(tokens) {
  let current = tokens;
  while (current.length > 0) {
    while (current.length > 0 && isEnvAssignment(current[0])) {
      current = current.slice(1);
    }
    if (current.length === 0) return current;

    const head = current[0];
    if (head === "sudo") {
      let index = 1;
      while (index < current.length && current[index].startsWith("-")) index += 1;
      current = current.slice(index);
      continue;
    }
    if (head === "env") {
      let index = 1;
      while (
        index < current.length &&
        (current[index].startsWith("-") || isEnvAssignment(current[index]))
      ) {
        index += 1;
      }
      current = current.slice(index);
      continue;
    }
    if (PREFIX_WRAPPERS.has(head)) {
      current = current.slice(1);
      continue;
    }
    if (SHELL_WRAPPERS.has(head) && current.length >= 3 && SHELL_EXEC_FLAGS.has(current[1])) {
      current = parseCommand(current[2]);
      continue;
    }
    return current;
  }
  return current;
}

function hasShortFlag(option, flag) {
  if (!option.startsWith("-") || option.startsWith("--")) return false;
  return option.slice(1).includes(flag);
}

function rmIsRecursiveForce(tokens) {
  let recursive = false;
  let force = false;
  for (const token of tokens.slice(1)) {
    if (token === "--") break;
    if (!token.startsWith("-")) break;
    if (token === "--recursive") {
      recursive = true;
      continue;
    }
    if (token === "--force") {
      force = true;
      continue;
    }
    if (hasShortFlag(token, "r") || hasShortFlag(token, "R")) recursive = true;
    if (hasShortFlag(token, "f")) force = true;
  }
  return recursive && force;
}

function gitCleanIsForceful(tokens) {
  let force = false;
  let dirs = false;
  for (const token of tokens.slice(2)) {
    if (token === "--") break;
    if (!token.startsWith("-")) break;
    if (hasShortFlag(token, "f")) force = true;
    if (hasShortFlag(token, "d")) dirs = true;
  }
  return force && dirs;
}

function findDelete(tokens) {
  return tokens.slice(1).some((token) => token === "-delete");
}

export function blockedReason(command) {
  const tokens = stripWrappers(parseCommand(command));
  if (tokens.length === 0) return null;

  if (tokens[0] === "rm" && rmIsRecursiveForce(tokens)) {
    return "Blocked destructive command pattern `rm -rf`.";
  }
  if (tokens.length >= 2 && tokens[0] === "terraform" && tokens[1] === "destroy") {
    return "Blocked destructive command pattern `terraform destroy`.";
  }
  if (
    tokens.length >= 3 &&
    tokens[0] === "git" &&
    tokens[1] === "reset" &&
    tokens.slice(2).includes("--hard")
  ) {
    return "Blocked destructive command pattern `git reset --hard`.";
  }
  if (
    tokens.length >= 2 &&
    tokens[0] === "git" &&
    tokens[1] === "clean" &&
    gitCleanIsForceful(tokens)
  ) {
    return "Blocked destructive command pattern `git clean -fd`.";
  }
  if (tokens[0] === "find" && findDelete(tokens)) {
    return "Blocked destructive command pattern `find ... -delete`.";
  }
  return null;
}

function main() {
  const command = process.env.CLAUDE_HOOK_COMMAND || "";
  const reason = blockedReason(command);
  if (!reason) return 0;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `${reason} Run it manually outside Claude Code if you really intend to delete state.`,
      },
    }) + "\n",
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
