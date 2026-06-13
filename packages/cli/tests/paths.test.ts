import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertInsideBase,
  configDir,
  credentialsPath,
  installDestination,
  type PathDeps,
} from "../src/paths.js";

function linuxDeps(env: Record<string, string | undefined> = {}): PathDeps {
  return {
    path: path.posix,
    homedir: () => "/home/alice",
    cwd: () => "/home/alice/project",
    platform: "linux",
    env,
  };
}

function windowsDeps(env: Record<string, string | undefined> = {}): PathDeps {
  return {
    path: path.win32,
    homedir: () => "C:\\Users\\alice",
    cwd: () => "C:\\Users\\alice\\project",
    platform: "win32",
    env: { APPDATA: "C:\\Users\\alice\\AppData\\Roaming", ...env },
  };
}

describe("configDir", () => {
  it("uses XDG_CONFIG_HOME when set (linux)", () => {
    expect(configDir(linuxDeps({ XDG_CONFIG_HOME: "/home/alice/.cfg" }))).toBe(
      "/home/alice/.cfg/skill-book",
    );
  });

  it("falls back to ~/.config (linux)", () => {
    expect(configDir(linuxDeps())).toBe("/home/alice/.config/skill-book");
  });

  it("uses %APPDATA% on windows", () => {
    expect(configDir(windowsDeps())).toBe("C:\\Users\\alice\\AppData\\Roaming\\skill-book");
  });

  it("derives APPDATA from the home directory when unset", () => {
    expect(configDir(windowsDeps({ APPDATA: undefined }))).toBe(
      "C:\\Users\\alice\\AppData\\Roaming\\skill-book",
    );
  });

  it("credentialsPath is inside the config dir", () => {
    expect(credentialsPath(linuxDeps())).toBe("/home/alice/.config/skill-book/credentials.json");
  });
});

describe("installDestination", () => {
  it("installs skills under ~/.claude/skills/<name>/ (linux)", () => {
    const dest = installDestination("CLAUDE_SKILL", "my-skill", {}, linuxDeps());
    expect(dest.baseDir).toBe("/home/alice/.claude/skills/my-skill");
    expect(dest.singleFile).toBeUndefined();
  });

  it("installs skills under %USERPROFILE%\\.claude\\skills\\<name> (windows)", () => {
    const dest = installDestination("CLAUDE_SKILL", "my-skill", {}, windowsDeps());
    expect(dest.baseDir).toBe("C:\\Users\\alice\\.claude\\skills\\my-skill");
  });

  it("CLAUDE.md goes to the cwd by default", () => {
    const dest = installDestination("CLAUDE_MD", "rules", {}, linuxDeps());
    expect(dest.singleFile).toBe("/home/alice/project/CLAUDE.md");
  });

  it("CLAUDE.md goes to ~/.claude with --global", () => {
    const dest = installDestination("CLAUDE_MD", "rules", { global: true }, linuxDeps());
    expect(dest.singleFile).toBe("/home/alice/.claude/CLAUDE.md");
  });

  it("AGENTS.md goes to the cwd by default (windows)", () => {
    const dest = installDestination("AGENTS_MD", "agents", {}, windowsDeps());
    expect(dest.singleFile).toBe("C:\\Users\\alice\\project\\AGENTS.md");
  });

  it("--dest overrides the skill directory", () => {
    const dest = installDestination("CLAUDE_SKILL", "my-skill", { dest: "vendor/sk" }, linuxDeps());
    expect(dest.baseDir).toBe("/home/alice/project/vendor/sk");
  });
});

describe("assertInsideBase", () => {
  it("accepts targets inside the base", () => {
    expect(() =>
      assertInsideBase(
        "/home/alice/.claude/skills/x",
        "/home/alice/.claude/skills/x/SKILL.md",
        linuxDeps(),
      ),
    ).not.toThrow();
  });

  it("rejects escapes via ..", () => {
    expect(() =>
      assertInsideBase(
        "/home/alice/.claude/skills/x",
        "/home/alice/.claude/skills/x/../../evil.md",
        linuxDeps(),
      ),
    ).toThrow(/outside the install target/);
  });

  it("rejects sibling-prefix tricks", () => {
    expect(() =>
      assertInsideBase(
        "/home/alice/.claude/skills/x",
        "/home/alice/.claude/skills/x-evil/a",
        linuxDeps(),
      ),
    ).toThrow(/outside the install target/);
  });

  it("works with windows separators", () => {
    expect(() =>
      assertInsideBase(
        "C:\\Users\\alice\\.claude\\skills\\x",
        "C:\\Users\\alice\\.claude\\skills\\x\\SKILL.md",
        windowsDeps(),
      ),
    ).not.toThrow();
    expect(() =>
      assertInsideBase(
        "C:\\Users\\alice\\.claude\\skills\\x",
        "C:\\Users\\alice\\evil.md",
        windowsDeps(),
      ),
    ).toThrow(/outside the install target/);
  });
});
