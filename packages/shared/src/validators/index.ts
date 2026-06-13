import { parse as parseYaml } from "yaml";
import type { ArtifactType } from "../types.js";
import type { ZipEntry } from "../zip/index.js";

export interface ValidationOk {
  ok: true;
  /** Entries re-rooted so the artifact content sits at the archive root. */
  entries: ZipEntry[];
  /** SKILL.md frontmatter (skills only). */
  frontmatter?: { name: string; description: string };
}

export interface ValidationError {
  ok: false;
  errors: string[];
}

export type ValidationResult = ValidationOk | ValidationError;

const decoder = new TextDecoder();

export interface SkillFrontmatter {
  name: string;
  description: string;
}

/** Parse `---\n...\n---` YAML frontmatter from a SKILL.md body. */
export function parseFrontmatter(markdown: string): SkillFrontmatter | null {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = parseYaml(match[1]!);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.name !== "string" || typeof obj.description !== "string") return null;
  if (obj.name.trim() === "" || obj.description.trim() === "") return null;
  return { name: obj.name.trim(), description: obj.description.trim() };
}

/**
 * If every entry lives under a single top-level directory (the way zipping a
 * skill folder usually produces), strip that prefix.
 */
function stripCommonRoot(entries: ZipEntry[]): ZipEntry[] {
  const roots = new Set(entries.map((e) => e.path.split("/")[0]));
  if (roots.size !== 1) return entries;
  const root = [...roots][0]!;
  if (!entries.every((e) => e.path.startsWith(`${root}/`))) return entries;
  return entries.map((e) => ({ ...e, data: e.data, path: e.path.slice(root.length + 1) }));
}

function validateSkill(rawEntries: ZipEntry[], artifactName: string): ValidationResult {
  const entries = stripCommonRoot(rawEntries);
  const skillMd = entries.find((e) => e.path === "SKILL.md");
  if (!skillMd) {
    return { ok: false, errors: ["CLAUDE_SKILL must contain SKILL.md at the root"] };
  }
  const frontmatter = parseFrontmatter(decoder.decode(skillMd.data));
  if (!frontmatter) {
    return {
      ok: false,
      errors: ["SKILL.md must start with YAML frontmatter containing `name` and `description`"],
    };
  }
  if (frontmatter.name !== artifactName) {
    return {
      ok: false,
      errors: [
        `SKILL.md frontmatter name (${frontmatter.name}) must match the artifact name (${artifactName})`,
      ],
    };
  }
  return { ok: true, entries, frontmatter };
}

function validateSingleMarkdown(
  rawEntries: ZipEntry[],
  expectedFileName: string,
): ValidationResult {
  const entries = stripCommonRoot(rawEntries);
  if (entries.length !== 1) {
    return {
      ok: false,
      errors: [`expected exactly one file (${expectedFileName}), got ${entries.length}`],
    };
  }
  const only = entries[0]!;
  if (only.path !== expectedFileName) {
    return { ok: false, errors: [`file must be named ${expectedFileName}, got ${only.path}`] };
  }
  if (only.data.length === 0) {
    return { ok: false, errors: [`${expectedFileName} is empty`] };
  }
  return { ok: true, entries };
}

export function validateArtifact(
  type: ArtifactType,
  entries: ZipEntry[],
  artifactName: string,
): ValidationResult {
  if (entries.length === 0) {
    return { ok: false, errors: ["archive contains no files"] };
  }
  switch (type) {
    case "CLAUDE_SKILL":
      return validateSkill(entries, artifactName);
    case "CLAUDE_MD":
      return validateSingleMarkdown(entries, "CLAUDE.md");
    case "AGENTS_MD":
      return validateSingleMarkdown(entries, "AGENTS.md");
  }
}

/** Concatenated text content used for search and preview (capped). */
export function buildContentText(entries: ZipEntry[], capBytes = 300 * 1024): string {
  let out = "";
  for (const entry of entries) {
    if (!/\.(md|txt|json|ya?ml|toml|sh|py|js|ts|mjs|cjs)$/i.test(entry.path)) continue;
    const text = decoder.decode(entry.data);
    if (text.includes("\u0000")) continue;
    out += `\n--- ${entry.path} ---\n${text}`;
    if (out.length >= capBytes) {
      return out.slice(0, capBytes);
    }
  }
  return out.trim();
}
