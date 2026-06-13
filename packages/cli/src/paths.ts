// All install-destination math goes through this module with injectable
// platform pieces, so Windows behaviour is unit-testable on Linux.

import nodePath from "node:path";
import { homedir as nodeHomedir } from "node:os";
import type { ArtifactType } from "@skill-book/shared";

export interface PathDeps {
  path: Pick<typeof nodePath, "join" | "resolve" | "sep">;
  homedir: () => string;
  cwd: () => string;
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
}

export function defaultPathDeps(): PathDeps {
  return {
    path: nodePath,
    homedir: nodeHomedir,
    cwd: () => process.cwd(),
    platform: process.platform,
    env: process.env,
  };
}

/** Where the CLI keeps its own config/credentials. The ONLY place it writes besides install targets. */
export function configDir(deps: PathDeps): string {
  if (deps.platform === "win32") {
    const appData = deps.env.APPDATA ?? deps.path.join(deps.homedir(), "AppData", "Roaming");
    return deps.path.join(appData, "skill-book");
  }
  const xdg = deps.env.XDG_CONFIG_HOME;
  if (xdg) return deps.path.join(xdg, "skill-book");
  return deps.path.join(deps.homedir(), ".config", "skill-book");
}

export function credentialsPath(deps: PathDeps): string {
  return deps.path.join(configDir(deps), "credentials.json");
}

export interface InstallOptions {
  global?: boolean;
  dest?: string;
}

export interface InstallPlanTarget {
  /** Directory that will receive content (skill) or contain the file (md types). */
  baseDir: string;
  /** For single-file types, the absolute file path. */
  singleFile?: string;
}

export function installDestination(
  type: ArtifactType,
  name: string,
  options: InstallOptions,
  deps: PathDeps,
): InstallPlanTarget {
  const { path } = deps;
  switch (type) {
    case "CLAUDE_SKILL": {
      const baseDir = options.dest
        ? path.resolve(deps.cwd(), options.dest)
        : path.join(deps.homedir(), ".claude", "skills", name);
      return { baseDir };
    }
    case "CLAUDE_MD": {
      if (options.dest) {
        const file = path.resolve(deps.cwd(), options.dest);
        return { baseDir: file, singleFile: file };
      }
      const file = options.global
        ? path.join(deps.homedir(), ".claude", "CLAUDE.md")
        : path.join(deps.cwd(), "CLAUDE.md");
      return { baseDir: file, singleFile: file };
    }
    case "AGENTS_MD": {
      if (options.dest) {
        const file = path.resolve(deps.cwd(), options.dest);
        return { baseDir: file, singleFile: file };
      }
      const file = options.global
        ? path.join(deps.homedir(), ".claude", "AGENTS.md")
        : path.join(deps.cwd(), "AGENTS.md");
      return { baseDir: file, singleFile: file };
    }
  }
}

/** Belt-and-suspenders: an extract path must stay inside the base directory. */
export function assertInsideBase(baseDir: string, target: string, deps: PathDeps): void {
  const resolvedBase = deps.path.resolve(baseDir);
  const resolvedTarget = deps.path.resolve(target);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + deps.path.sep)) {
    throw new Error(`refusing to write outside the install target: ${target}`);
  }
}
