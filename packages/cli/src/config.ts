import { readFileSync } from "node:fs";
import { credentialsPath, defaultPathDeps, type PathDeps } from "./paths.js";

export const DEFAULT_API_URL = "https://api.skill-book.dev.devtools.site";

export interface CliConfig {
  apiUrl: string;
  /** Integration bypass token (testing) — used directly as the bearer token when set. */
  bypassToken?: string;
}

export function loadCliConfig(env: NodeJS.ProcessEnv = process.env): CliConfig {
  return {
    apiUrl: (env.SKILL_BOOK_API_URL ?? DEFAULT_API_URL).replace(/\/$/, ""),
    bypassToken: env.SKILL_BOOK_BYPASS_TOKEN,
  };
}

export interface StoredCredentials {
  idToken: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  email: string;
  /** Cognito config snapshot taken at login time (for refresh). */
  cognitoDomain: string;
  cognitoClientId: string;
  region: string;
}

export function readStoredCredentials(
  deps: PathDeps = defaultPathDeps(),
): StoredCredentials | null {
  try {
    return JSON.parse(readFileSync(credentialsPath(deps), "utf8")) as StoredCredentials;
  } catch {
    return null;
  }
}
