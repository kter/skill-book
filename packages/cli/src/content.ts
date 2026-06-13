// Collect local files into zip entries for push, with type/name detection.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ArtifactType } from "@skill-book/shared";
import type { ZipEntry } from "@skill-book/shared/zip";

const IGNORED_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv", "dist", ".next"]);
const MAX_FILES = 2000;

export interface CollectedContent {
  entries: ZipEntry[];
  detectedType: ArtifactType;
  suggestedName: string;
}

function walk(dir: string, prefix: string, entries: ZipEntry[]): void {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (entries.length > MAX_FILES) {
      throw new Error(`too many files (>${MAX_FILES}) under ${dir}`);
    }
    const full = path.join(dir, item.name);
    const rel = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isSymbolicLink()) continue; // never follow symlinks out of the tree
    if (item.isDirectory()) {
      if (IGNORED_DIRS.has(item.name)) continue;
      walk(full, rel, entries);
    } else if (item.isFile()) {
      entries.push({ path: rel, data: new Uint8Array(readFileSync(full)) });
    }
  }
}

export function collectContent(targetPath: string): CollectedContent {
  const resolved = path.resolve(targetPath);
  const stats = statSync(resolved);

  if (stats.isFile()) {
    const base = path.basename(resolved);
    const entries: ZipEntry[] = [{ path: base, data: new Uint8Array(readFileSync(resolved)) }];
    const detectedType: ArtifactType =
      base === "CLAUDE.md" ? "CLAUDE_MD" : base === "AGENTS.md" ? "AGENTS_MD" : "CLAUDE_SKILL";
    if (detectedType === "CLAUDE_SKILL" && base !== "SKILL.md") {
      throw new Error(
        `cannot infer type for file "${base}" — expected CLAUDE.md, AGENTS.md, or SKILL.md`,
      );
    }
    return { entries, detectedType, suggestedName: slugify(path.basename(path.dirname(resolved))) };
  }

  const entries: ZipEntry[] = [];
  walk(resolved, "", entries);
  if (!entries.some((e) => e.path === "SKILL.md")) {
    throw new Error(`directory ${resolved} does not contain SKILL.md at its root`);
  }
  return {
    entries,
    detectedType: "CLAUDE_SKILL",
    suggestedName: slugify(path.basename(resolved)),
  };
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
