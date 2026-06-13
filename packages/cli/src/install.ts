// Extraction with the never-touch guarantee: writes only inside the resolved
// install target, never overwrites without force, dry-run writes nothing.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ArtifactType } from "@skill-book/shared";
import type { ZipEntry } from "@skill-book/shared/zip";
import {
  assertInsideBase,
  defaultPathDeps,
  installDestination,
  type InstallOptions,
  type PathDeps,
} from "./paths.js";

export interface InstallPlan {
  baseDir: string;
  files: { source: ZipEntry; target: string }[];
  conflicts: string[];
}

export function planInstall(
  type: ArtifactType,
  name: string,
  entries: ZipEntry[],
  options: InstallOptions,
  deps: PathDeps = defaultPathDeps(),
): InstallPlan {
  const destination = installDestination(type, name, options, deps);

  if (destination.singleFile) {
    const entry = entries[0];
    if (!entry || entries.length !== 1) {
      throw new Error(`expected a single file for ${type}, got ${entries.length}`);
    }
    const target = destination.singleFile;
    return {
      baseDir: target,
      files: [{ source: entry, target }],
      conflicts: existsSync(target) ? [target] : [],
    };
  }

  const files = entries.map((entry) => {
    const target = deps.path.join(destination.baseDir, ...entry.path.split("/"));
    assertInsideBase(destination.baseDir, target, deps);
    return { source: entry, target };
  });
  return {
    baseDir: destination.baseDir,
    files,
    conflicts: files.map((f) => f.target).filter((t) => existsSync(t)),
  };
}

export interface ExecuteInstallOptions {
  force?: boolean;
  dryRun?: boolean;
}

export function executeInstall(plan: InstallPlan, options: ExecuteInstallOptions): string[] {
  if (plan.conflicts.length > 0 && !options.force) {
    throw new Error(
      `refusing to overwrite existing files (use --force):\n  ${plan.conflicts.join("\n  ")}`,
    );
  }
  const written: string[] = [];
  if (options.dryRun) return written;
  for (const file of plan.files) {
    mkdirSync(path.dirname(file.target), { recursive: true });
    writeFileSync(file.target, file.source.data);
    written.push(file.target);
  }
  return written;
}
