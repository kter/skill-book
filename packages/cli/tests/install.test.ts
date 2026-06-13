import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ZipEntry } from "@skill-book/shared/zip";
import { executeInstall, planInstall } from "../src/install.js";
import type { PathDeps } from "../src/paths.js";

const enc = new TextEncoder();

let sandbox: string;

function deps(): PathDeps {
  return {
    path,
    homedir: () => path.join(sandbox, "home"),
    cwd: () => path.join(sandbox, "cwd"),
    platform: "linux",
    env: {},
  };
}

function entries(files: Record<string, string>): ZipEntry[] {
  return Object.entries(files).map(([p, content]) => ({ path: p, data: enc.encode(content) }));
}

beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "skill-book-cli-"));
  mkdirSync(path.join(sandbox, "home"), { recursive: true });
  mkdirSync(path.join(sandbox, "cwd"), { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("planInstall + executeInstall", () => {
  it("installs a skill into ~/.claude/skills/<name>/", () => {
    const plan = planInstall(
      "CLAUDE_SKILL",
      "my-skill",
      entries({ "SKILL.md": "# skill", "scripts/run.sh": "echo hi" }),
      {},
      deps(),
    );
    const written = executeInstall(plan, {});
    expect(written).toHaveLength(2);
    const skillMd = path.join(sandbox, "home", ".claude", "skills", "my-skill", "SKILL.md");
    expect(readFileSync(skillMd, "utf8")).toBe("# skill");
    expect(existsSync(path.join(plan.baseDir, "scripts", "run.sh"))).toBe(true);
  });

  it("installs CLAUDE.md into the cwd", () => {
    const plan = planInstall("CLAUDE_MD", "rules", entries({ "CLAUDE.md": "# rules" }), {}, deps());
    executeInstall(plan, {});
    expect(readFileSync(path.join(sandbox, "cwd", "CLAUDE.md"), "utf8")).toBe("# rules");
  });

  it("refuses to overwrite without --force", () => {
    writeFileSync(path.join(sandbox, "cwd", "CLAUDE.md"), "precious local edits");
    const plan = planInstall("CLAUDE_MD", "rules", entries({ "CLAUDE.md": "new" }), {}, deps());
    expect(plan.conflicts).toHaveLength(1);
    expect(() => executeInstall(plan, {})).toThrow(/refusing to overwrite/);
    // the original file is untouched
    expect(readFileSync(path.join(sandbox, "cwd", "CLAUDE.md"), "utf8")).toBe(
      "precious local edits",
    );
  });

  it("overwrites with --force", () => {
    writeFileSync(path.join(sandbox, "cwd", "CLAUDE.md"), "old");
    const plan = planInstall("CLAUDE_MD", "rules", entries({ "CLAUDE.md": "new" }), {}, deps());
    executeInstall(plan, { force: true });
    expect(readFileSync(path.join(sandbox, "cwd", "CLAUDE.md"), "utf8")).toBe("new");
  });

  it("dry-run writes nothing", () => {
    const plan = planInstall("CLAUDE_SKILL", "dry", entries({ "SKILL.md": "x" }), {}, deps());
    const written = executeInstall(plan, { dryRun: true });
    expect(written).toHaveLength(0);
    expect(existsSync(plan.baseDir)).toBe(false);
  });

  it("rejects entries that would escape the install target", () => {
    expect(() =>
      planInstall("CLAUDE_SKILL", "evil", entries({ "../escape.md": "x" }), {}, deps()),
    ).toThrow(/outside the install target/);
  });

  it("honours --global for CLAUDE.md", () => {
    const plan = planInstall(
      "CLAUDE_MD",
      "rules",
      entries({ "CLAUDE.md": "# global" }),
      { global: true },
      deps(),
    );
    executeInstall(plan, {});
    expect(readFileSync(path.join(sandbox, "home", ".claude", "CLAUDE.md"), "utf8")).toBe(
      "# global",
    );
  });
});
