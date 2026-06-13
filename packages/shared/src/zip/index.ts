import { unzipSync, zipSync, type Zippable } from "fflate";

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

export interface ZipLimits {
  maxEntries: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 2000,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
};

export class ZipSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipSafetyError";
  }
}

/** Normalize a zip entry path and reject anything that could escape the extract root. */
export function assertSafeEntryPath(rawPath: string): string {
  const path = rawPath.replace(/\\/g, "/");
  if (path.length === 0) {
    throw new ZipSafetyError("empty entry path");
  }
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new ZipSafetyError(`absolute entry path: ${rawPath}`);
  }
  const segments = path.split("/");
  if (segments.includes("..")) {
    throw new ZipSafetyError(`path traversal in entry: ${rawPath}`);
  }
  if (segments.includes("")) {
    // interior empty segment ("a//b") — tolerate trailing slash for dirs only
    if (!path.endsWith("/") || segments.slice(0, -1).includes("")) {
      throw new ZipSafetyError(`malformed entry path: ${rawPath}`);
    }
  }
  return path;
}

/**
 * Unzip into memory with safety guards (zip-slip, entry count, per-file and
 * total decompressed size). Directory entries are dropped; only regular file
 * contents are returned — symlink entries therefore become inert data.
 */
export function safeUnzip(zipData: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntry[] {
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(zipData);
  } catch (err) {
    throw new ZipSafetyError(`invalid zip archive: ${err instanceof Error ? err.message : err}`);
  }

  const entries: ZipEntry[] = [];
  let totalBytes = 0;
  const paths = Object.keys(unzipped);
  if (paths.length > limits.maxEntries) {
    throw new ZipSafetyError(`too many entries: ${paths.length} > ${limits.maxEntries}`);
  }
  for (const rawPath of paths) {
    const path = assertSafeEntryPath(rawPath);
    if (path.endsWith("/")) continue; // directory entry
    const data = unzipped[rawPath]!;
    if (data.length > limits.maxFileBytes) {
      throw new ZipSafetyError(`entry too large: ${path} (${data.length} bytes)`);
    }
    totalBytes += data.length;
    if (totalBytes > limits.maxTotalBytes) {
      throw new ZipSafetyError(`total decompressed size exceeds ${limits.maxTotalBytes} bytes`);
    }
    entries.push({ path, data });
  }
  return entries;
}

/** Create a zip from entries with deterministic ordering (stable hashes). */
export function createZip(entries: ZipEntry[]): Uint8Array {
  const zippable: Zippable = {};
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    zippable[entry.path] = entry.data;
  }
  return zipSync(zippable, { level: 6, mtime: new Date("2000-01-01T00:00:00Z") });
}
