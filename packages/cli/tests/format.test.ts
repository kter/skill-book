import { describe, expect, it } from "vitest";
import { friendlyError, isNetworkError, parseVersionSpec, truncate } from "../src/format.js";

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
      'invalid version "bogus" — use a version number (e.g. my-skill@2) or my-skill@latest',
    );
  });

  it("rejects a fractional version", () => {
    expect(() => parseVersionSpec("my-skill@1.5")).toThrow(/invalid version "1\.5"/);
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
