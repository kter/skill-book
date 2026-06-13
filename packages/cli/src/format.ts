// Pure formatting / parsing helpers shared by the CLI commands (unit-tested).

import { ARTIFACT_TYPES, type ArtifactType } from "@skill-book/shared";

/** Validate a `--type` filter value against the known artifact types, throwing a
 *  message that lists the valid values (the server otherwise returns a generic
 *  "invalid query"). Returns undefined when no filter was given. */
export function validateTypeFilter(type: string | undefined): ArtifactType | undefined {
  if (type == null) return undefined;
  if ((ARTIFACT_TYPES as readonly string[]).includes(type)) return type as ArtifactType;
  throw new Error(`invalid --type "${type}" — use one of: ${ARTIFACT_TYPES.join(", ")}`);
}

/** Node fetch failures surface as `TypeError: fetch failed` whose `cause.code`
 *  is one of these. Keep the set narrow so unrelated wrapped errors are not
 *  mislabelled as connectivity problems. */
const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

export function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message === "fetch failed") return true;
  const code = (err as { cause?: { code?: string } }).cause?.code;
  return code != null && NETWORK_ERROR_CODES.has(code);
}

/** Human-readable message for the top-level error handler. Connectivity
 *  failures become an actionable hint; everything else keeps its own message. */
export function friendlyError(err: unknown, apiUrl: string): string {
  if (isNetworkError(err)) {
    return `cannot reach the registry API at ${apiUrl} — check your connection or SKILL_BOOK_API_URL`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Truncate to at most `max` characters, appending an ellipsis when clipped.
 *  Counts by code points so surrogate pairs are never split. */
export function truncate(value: string, max: number): string {
  const chars = [...value];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : value;
}

export interface VersionSpec {
  name: string;
  /** undefined means "latest" (explicit `@latest` or no `@version`). */
  version: number | undefined;
}

/** Parse `name`, `name@<n>`, or `name@latest`. Throws on an empty name or a
 *  version that is not a positive decimal integer (rejecting `""`, `-1`, `0`,
 *  `0x10`, `3e2`, and surrounding whitespace, which `Number()` would silently
 *  accept). */
export function parseVersionSpec(nameSpec: string): VersionSpec {
  const [name, versionRaw] = nameSpec.split("@");
  if (!name) {
    throw new Error('missing artifact name — use "name", "name@2", or "name@latest"');
  }
  if (!versionRaw || versionRaw === "latest") return { name, version: undefined };
  if (!/^\d+$/.test(versionRaw) || Number(versionRaw) < 1) {
    throw new Error(
      `invalid version "${versionRaw}" — use a positive version number (e.g. ${name}@2) or ${name}@latest`,
    );
  }
  return { name, version: Number(versionRaw) };
}
