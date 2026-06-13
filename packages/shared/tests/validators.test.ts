import { describe, expect, it } from "vitest";
import { buildContentText, parseFrontmatter, validateArtifact } from "../src/validators/index.js";
import type { ZipEntry } from "../src/zip/index.js";

const enc = new TextEncoder();

function entry(path: string, content: string): ZipEntry {
  return { path, data: enc.encode(content) };
}

const VALID_SKILL_MD = `---
name: my-skill
description: Does something useful
---

# my-skill

Instructions here.
`;

describe("parseFrontmatter", () => {
  it("parses name and description", () => {
    expect(parseFrontmatter(VALID_SKILL_MD)).toEqual({
      name: "my-skill",
      description: "Does something useful",
    });
  });

  it("returns null without frontmatter", () => {
    expect(parseFrontmatter("# just markdown")).toBeNull();
  });

  it("returns null when name is missing", () => {
    expect(parseFrontmatter("---\ndescription: x\n---\nbody")).toBeNull();
  });

  it("returns null on invalid yaml", () => {
    expect(parseFrontmatter("---\n: : :\n---\nbody")).toBeNull();
  });

  it("handles CRLF line endings", () => {
    const crlf = "---\r\nname: my-skill\r\ndescription: d\r\n---\r\nbody";
    expect(parseFrontmatter(crlf)).toEqual({ name: "my-skill", description: "d" });
  });
});

describe("validateArtifact CLAUDE_SKILL", () => {
  it("accepts a valid skill at archive root", () => {
    const result = validateArtifact(
      "CLAUDE_SKILL",
      [entry("SKILL.md", VALID_SKILL_MD), entry("scripts/run.sh", "echo hi")],
      "my-skill",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.frontmatter).toEqual({
        name: "my-skill",
        description: "Does something useful",
      });
    }
  });

  it("strips a single top-level directory", () => {
    const result = validateArtifact(
      "CLAUDE_SKILL",
      [entry("my-skill/SKILL.md", VALID_SKILL_MD), entry("my-skill/extra.md", "x")],
      "my-skill",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries.map((e) => e.path).sort()).toEqual(["SKILL.md", "extra.md"]);
    }
  });

  it("rejects a skill without SKILL.md", () => {
    const result = validateArtifact("CLAUDE_SKILL", [entry("README.md", "x")], "my-skill");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/SKILL\.md/);
  });

  it("rejects frontmatter name mismatch", () => {
    const result = validateArtifact("CLAUDE_SKILL", [entry("SKILL.md", VALID_SKILL_MD)], "other");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/must match the artifact name/);
  });

  it("rejects missing frontmatter", () => {
    const result = validateArtifact("CLAUDE_SKILL", [entry("SKILL.md", "# no fm")], "my-skill");
    expect(result.ok).toBe(false);
  });
});

describe("validateArtifact single-markdown types", () => {
  it("accepts a CLAUDE.md", () => {
    const result = validateArtifact("CLAUDE_MD", [entry("CLAUDE.md", "# rules")], "my-rules");
    expect(result.ok).toBe(true);
  });

  it("accepts an AGENTS.md", () => {
    const result = validateArtifact("AGENTS_MD", [entry("AGENTS.md", "# agents")], "my-agents");
    expect(result.ok).toBe(true);
  });

  it("rejects a wrong filename", () => {
    const result = validateArtifact("CLAUDE_MD", [entry("OTHER.md", "x")], "n");
    expect(result.ok).toBe(false);
  });

  it("rejects multiple files", () => {
    const result = validateArtifact(
      "CLAUDE_MD",
      [entry("CLAUDE.md", "x"), entry("extra.md", "y")],
      "n",
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an empty file", () => {
    const result = validateArtifact("AGENTS_MD", [entry("AGENTS.md", "")], "n");
    expect(result.ok).toBe(false);
  });

  it("rejects an empty archive", () => {
    const result = validateArtifact("CLAUDE_MD", [], "n");
    expect(result.ok).toBe(false);
  });
});

describe("buildContentText", () => {
  it("concatenates text files with separators", () => {
    const text = buildContentText([entry("SKILL.md", "# title"), entry("notes.txt", "hello")]);
    expect(text).toContain("--- SKILL.md ---");
    expect(text).toContain("# title");
    expect(text).toContain("hello");
  });

  it("skips non-text extensions and binary content", () => {
    const binary: ZipEntry = { path: "img.md", data: new Uint8Array([0, 1, 2]) };
    const text = buildContentText([entry("logo.png", "PNG"), binary]);
    expect(text).toBe("");
  });

  it("caps output size", () => {
    const big = entry("big.md", "x".repeat(500_000));
    expect(buildContentText([big], 1000).length).toBeLessThanOrEqual(1000);
  });
});
