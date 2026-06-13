import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import {
  assertSafeEntryPath,
  createZip,
  safeUnzip,
  ZipSafetyError,
  type ZipEntry,
} from "../src/zip/index.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

function makeZip(files: Record<string, string>): Uint8Array {
  const zippable: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    zippable[path] = enc.encode(content);
  }
  return zipSync(zippable);
}

describe("assertSafeEntryPath", () => {
  it.each(["../etc/passwd", "a/../../b", "a/b/../../../c", ".."])(
    "rejects traversal: %s",
    (path) => {
      expect(() => assertSafeEntryPath(path)).toThrow(ZipSafetyError);
    },
  );

  it.each(["/etc/passwd", "C:/windows/system32", "c:evil"])("rejects absolute: %s", (path) => {
    expect(() => assertSafeEntryPath(path)).toThrow(ZipSafetyError);
  });

  it("normalizes backslashes", () => {
    expect(assertSafeEntryPath("dir\\file.md")).toBe("dir/file.md");
    expect(() => assertSafeEntryPath("..\\escape.md")).toThrow(ZipSafetyError);
  });

  it("accepts normal nested paths", () => {
    expect(assertSafeEntryPath("skill/SKILL.md")).toBe("skill/SKILL.md");
  });
});

describe("safeUnzip", () => {
  it("round-trips a normal archive", () => {
    const zip = makeZip({ "SKILL.md": "# hello", "scripts/run.sh": "echo hi" });
    const entries = safeUnzip(zip);
    expect(entries.map((e) => e.path).sort()).toEqual(["SKILL.md", "scripts/run.sh"]);
    expect(dec.decode(entries.find((e) => e.path === "SKILL.md")!.data)).toBe("# hello");
  });

  it("rejects traversal entries", () => {
    const zip = makeZip({ "../escape.md": "evil" });
    expect(() => safeUnzip(zip)).toThrow(ZipSafetyError);
  });

  it("rejects too many entries", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 11; i++) files[`f${i}.md`] = "x";
    const zip = makeZip(files);
    expect(() => safeUnzip(zip, { maxEntries: 10, maxFileBytes: 1e6, maxTotalBytes: 1e7 })).toThrow(
      /too many entries/,
    );
  });

  it("rejects oversized files (decompression bomb)", () => {
    const zip = makeZip({ "bomb.txt": "0".repeat(200_000) });
    expect(() =>
      safeUnzip(zip, { maxEntries: 10, maxFileBytes: 100_000, maxTotalBytes: 1e7 }),
    ).toThrow(/entry too large/);
  });

  it("rejects archives whose total size exceeds the cap", () => {
    const zip = makeZip({ "a.txt": "0".repeat(60_000), "b.txt": "0".repeat(60_000) });
    expect(() =>
      safeUnzip(zip, { maxEntries: 10, maxFileBytes: 100_000, maxTotalBytes: 100_000 }),
    ).toThrow(/total decompressed size/);
  });

  it("rejects garbage data", () => {
    expect(() => safeUnzip(enc.encode("not a zip"))).toThrow(ZipSafetyError);
  });
});

describe("createZip", () => {
  it("is deterministic regardless of entry order", () => {
    const a: ZipEntry[] = [
      { path: "b.md", data: enc.encode("b") },
      { path: "a.md", data: enc.encode("a") },
    ];
    const b: ZipEntry[] = [...a].reverse();
    expect(Buffer.from(createZip(a)).equals(Buffer.from(createZip(b)))).toBe(true);
  });

  it("round-trips through safeUnzip", () => {
    const zip = createZip([{ path: "SKILL.md", data: enc.encode("# skill") }]);
    const entries = safeUnzip(zip);
    expect(entries).toHaveLength(1);
    expect(dec.decode(entries[0]!.data)).toBe("# skill");
  });
});
