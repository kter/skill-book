import type { ArtifactType } from "@skill-book/shared";
import type { ZipEntry } from "@skill-book/shared/zip";

export interface PickedFile {
  /** Path relative to the picked root (webkitRelativePath or file name). */
  path: string;
  data: Uint8Array;
}

/** Infer the artifact type from the picked files. Returns null when ambiguous. */
export function detectArtifactType(paths: string[]): ArtifactType | null {
  const basenames = paths.map((p) => p.split("/").pop() ?? p);
  if (paths.length === 1) {
    if (basenames[0] === "CLAUDE.md") return "CLAUDE_MD";
    if (basenames[0] === "AGENTS.md") return "AGENTS_MD";
    if (basenames[0] === "SKILL.md") return "CLAUDE_SKILL";
  }
  if (basenames.includes("SKILL.md")) return "CLAUDE_SKILL";
  return null;
}

/** Suggest a kebab-case artifact name from the picked files. */
export function suggestName(paths: string[]): string {
  const first = paths[0] ?? "";
  const root = first.includes("/") ? first.split("/")[0]! : first.replace(/\.md$/i, "");
  return root
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function toZipEntries(files: PickedFile[]): ZipEntry[] {
  return files.map((f) => ({ path: f.path, data: f.data }));
}
