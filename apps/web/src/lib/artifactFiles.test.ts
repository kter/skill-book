import { describe, expect, it } from "vitest";
import { detectArtifactType, suggestName } from "./artifactFiles";

describe("detectArtifactType", () => {
  it("detects a single CLAUDE.md", () => {
    expect(detectArtifactType(["CLAUDE.md"])).toBe("CLAUDE_MD");
  });

  it("detects a single AGENTS.md", () => {
    expect(detectArtifactType(["AGENTS.md"])).toBe("AGENTS_MD");
  });

  it("detects a skill folder containing SKILL.md", () => {
    expect(detectArtifactType(["my-skill/SKILL.md", "my-skill/scripts/run.sh"])).toBe(
      "CLAUDE_SKILL",
    );
  });

  it("detects a bare SKILL.md", () => {
    expect(detectArtifactType(["SKILL.md"])).toBe("CLAUDE_SKILL");
  });

  it("returns null for unknown layouts", () => {
    expect(detectArtifactType(["README.md", "notes.txt"])).toBeNull();
  });
});

describe("suggestName", () => {
  it("uses the folder name for directories", () => {
    expect(suggestName(["My Skill/SKILL.md"])).toBe("my-skill");
  });

  it("strips the extension for single files", () => {
    expect(suggestName(["CLAUDE.md"])).toBe("claude");
  });

  it("sanitizes to a kebab slug", () => {
    expect(suggestName(["Hello_World 2/SKILL.md"])).toBe("hello-world-2");
  });
});
