import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectContent, slugify } from "../src/content.js";

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "skill-book-content-"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("collectContent", () => {
  it("collects a skill directory and detects the type", () => {
    const dir = path.join(sandbox, "My Skill");
    mkdirSync(path.join(dir, "scripts"), { recursive: true });
    writeFileSync(path.join(dir, "SKILL.md"), "---\nname: my-skill\ndescription: d\n---\n");
    writeFileSync(path.join(dir, "scripts", "run.sh"), "echo hi");

    const content = collectContent(dir);
    expect(content.detectedType).toBe("CLAUDE_SKILL");
    expect(content.suggestedName).toBe("my-skill");
    expect(content.entries.map((e) => e.path).sort()).toEqual(["SKILL.md", "scripts/run.sh"]);
  });

  it("skips ignored directories and symlinks", () => {
    const dir = path.join(sandbox, "skill");
    mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
    mkdirSync(path.join(dir, ".git"), { recursive: true });
    writeFileSync(path.join(dir, "SKILL.md"), "x");
    writeFileSync(path.join(dir, "node_modules", "x", "dep.js"), "x");
    writeFileSync(path.join(dir, ".git", "config"), "x");
    symlinkSync("/etc/passwd", path.join(dir, "link"));

    const content = collectContent(dir);
    expect(content.entries.map((e) => e.path)).toEqual(["SKILL.md"]);
  });

  it("detects single CLAUDE.md / AGENTS.md files", () => {
    writeFileSync(path.join(sandbox, "CLAUDE.md"), "# rules");
    expect(collectContent(path.join(sandbox, "CLAUDE.md")).detectedType).toBe("CLAUDE_MD");
    writeFileSync(path.join(sandbox, "AGENTS.md"), "# agents");
    expect(collectContent(path.join(sandbox, "AGENTS.md")).detectedType).toBe("AGENTS_MD");
  });

  it("rejects directories without SKILL.md", () => {
    const dir = path.join(sandbox, "not-a-skill");
    mkdirSync(dir);
    writeFileSync(path.join(dir, "README.md"), "x");
    expect(() => collectContent(dir)).toThrow(/SKILL\.md/);
  });

  it("rejects unrecognized single files", () => {
    writeFileSync(path.join(sandbox, "notes.md"), "x");
    expect(() => collectContent(path.join(sandbox, "notes.md"))).toThrow(/cannot infer type/);
  });
});

describe("slugify", () => {
  it.each([
    ["My Skill", "my-skill"],
    ["CLAUDE.md", "claude"],
    ["hello__world--2", "hello-world-2"],
    ["--trim--", "trim"],
  ])("%s -> %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});
