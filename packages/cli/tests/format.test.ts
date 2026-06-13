import { describe, expect, it } from "vitest";
import {
  friendlyError,
  isNetworkError,
  notFoundMessage,
  parseVersionSpec,
  truncate,
  validateTypeFilter,
} from "../src/format.js";

describe("notFoundMessage", () => {
  it("returns null for non-404 statuses (caller rethrows)", () => {
    expect(notFoundMessage(500, "boom", "my-skill")).toBeNull();
    expect(notFoundMessage(403, undefined, "my-skill")).toBeNull();
  });

  it("names the artifact and suggests search on a plain 404", () => {
    expect(notFoundMessage(404, "not found", "my-skill")).toBe(
      'artifact "my-skill" not found — run `skill-book search my-skill` to look it up',
    );
  });

  it("points at info when the version is unpublished, echoing the requested version", () => {
    expect(notFoundMessage(404, "no published version available", "my-skill", 3)).toBe(
      'no published version of "my-skill@3" — run `skill-book info my-skill` to see available versions',
    );
  });

  it("omits the version suffix when none was requested", () => {
    expect(notFoundMessage(404, "no published version available", "my-skill")).toBe(
      'no published version of "my-skill" — run `skill-book info my-skill` to see available versions',
    );
  });
});

describe("validateTypeFilter", () => {
  it("returns undefined when no filter is given", () => {
    expect(validateTypeFilter(undefined)).toBeUndefined();
  });

  it("passes through valid artifact types", () => {
    expect(validateTypeFilter("CLAUDE_SKILL")).toBe("CLAUDE_SKILL");
    expect(validateTypeFilter("AGENTS_MD")).toBe("AGENTS_MD");
  });

  it("rejects an unknown type, listing the valid values", () => {
    expect(() => validateTypeFilter("BOGUS")).toThrow(
      'invalid --type "BOGUS" — use one of: CLAUDE_SKILL, CLAUDE_MD, AGENTS_MD',
    );
    // case-sensitive: lowercase is not accepted
    expect(() => validateTypeFilter("claude_skill")).toThrow(/invalid --type/);
  });
});

describe("parseVersionSpec", () => {
  it("treats a bare name as latest", () => {
    expect(parseVersionSpec("my-skill")).toEqual({ name: "my-skill", version: undefined });
  });

  it("treats @latest as latest", () => {
    expect(parseVersionSpec("my-skill@latest")).toEqual({ name: "my-skill", version: undefined });
  });

  it("treats a trailing @ as latest", () => {
    expect(parseVersionSpec("my-skill@")).toEqual({ name: "my-skill", version: undefined });
  });

  it("parses an integer version", () => {
    expect(parseVersionSpec("my-skill@3")).toEqual({ name: "my-skill", version: 3 });
  });

  it("rejects a non-integer version with an actionable message", () => {
    expect(() => parseVersionSpec("my-skill@bogus")).toThrow(
      'invalid version "bogus" — use a positive version number (e.g. my-skill@2) or my-skill@latest',
    );
  });

  it("rejects a fractional version", () => {
    expect(() => parseVersionSpec("my-skill@1.5")).toThrow(/invalid version "1\.5"/);
  });

  it("rejects an empty artifact name", () => {
    expect(() => parseVersionSpec("@latest")).toThrow(/missing artifact name/);
    expect(() => parseVersionSpec("@3")).toThrow(/missing artifact name/);
    expect(() => parseVersionSpec("")).toThrow(/missing artifact name/);
  });

  it("rejects non-positive and exotic numeric versions Number() would accept", () => {
    for (const bad of ["0", "-1", "0x10", "3e2", " 3 ", "+3"]) {
      expect(() => parseVersionSpec(`my-skill@${bad}`)).toThrow(/invalid version/);
    }
  });
});

describe("isNetworkError", () => {
  it("flags a bare fetch failure", () => {
    expect(isNetworkError(new TypeError("fetch failed"))).toBe(true);
  });

  it("flags a wrapped connectivity code", () => {
    const err = new Error("fetch failed", { cause: { code: "ECONNREFUSED" } });
    expect(isNetworkError(err)).toBe(true);
  });

  it("does not flag an unrelated wrapped error code", () => {
    const err = new Error("boom", { cause: { code: "ENOENT" } });
    expect(isNetworkError(err)).toBe(false);
  });

  it("does not flag a plain error or non-error", () => {
    expect(isNetworkError(new Error("validation failed"))).toBe(false);
    expect(isNetworkError("nope")).toBe(false);
  });
});

describe("friendlyError", () => {
  it("translates connectivity failures, naming the configured URL", () => {
    const msg = friendlyError(new TypeError("fetch failed"), "https://api.example.test");
    expect(msg).toBe(
      "cannot reach the registry API at https://api.example.test — check your connection or SKILL_BOOK_API_URL",
    );
  });

  it("passes through non-network error messages", () => {
    expect(friendlyError(new Error("validation failed: name taken"), "x")).toBe(
      "validation failed: name taken",
    );
  });

  it("stringifies non-error throwables", () => {
    expect(friendlyError("weird", "x")).toBe("weird");
  });
});

describe("truncate", () => {
  it("leaves short strings untouched", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("exactly-ten", 11)).toBe("exactly-ten");
  });

  it("clips long strings with an ellipsis", () => {
    expect(truncate("abcdefghij", 5)).toBe("abcd…");
  });

  it("counts by code point so surrogate pairs are not split", () => {
    // Five astral code points; clip to 3 → 2 kept + ellipsis, each intact.
    expect(truncate("😀😁😂😃😄", 3)).toBe("😀😁…");
  });
});
