import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import readline from "node:readline";
import {
  loadCliConfig,
  readStoredCredentials,
  type CliConfig,
  type StoredCredentials,
} from "./config.js";
import { configDir, credentialsPath, defaultPathDeps } from "./paths.js";

const LOOPBACK_PORT = 8765;

interface RemoteConfig {
  region: string;
  cognitoUserPoolId: string | null;
  cognitoDomain: string | null;
  cognitoCliClientId: string | null;
}

async function fetchRemoteConfig(config: CliConfig): Promise<RemoteConfig> {
  const res = await fetch(`${config.apiUrl}/config`);
  if (!res.ok) {
    throw new Error(`failed to fetch client config from ${config.apiUrl}/config (${res.status})`);
  }
  return (await res.json()) as RemoteConfig;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1] ?? "";
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function saveCredentials(credentials: StoredCredentials): void {
  const deps = defaultPathDeps();
  mkdirSync(configDir(deps), { recursive: true });
  writeFileSync(credentialsPath(deps), JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

export function clearCredentials(): void {
  const deps = defaultPathDeps();
  try {
    writeFileSync(credentialsPath(deps), "{}", { mode: 0o600 });
  } catch {
    /* nothing stored */
  }
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url.replace(/&/g, "^&")] : [url];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.unref();
    child.on("error", () => {});
  } catch {
    /* fall back to printed URL */
  }
}

function waitForLoopbackCode(): Promise<{ code: string } | null> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${LOOPBACK_PORT}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<html><body><h2>skill-book login complete</h2>You can close this tab and return to the terminal.</body></html>",
      );
      server.close();
      resolve(code ? { code } : null);
    });
    server.on("error", () => resolve(null)); // port busy → headless fallback
    server.listen(LOOPBACK_PORT, "127.0.0.1");
  });
}

async function promptLine(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  return answer.trim();
}

async function exchangeCode(
  remote: RemoteConfig,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<StoredCredentials> {
  const res = await fetch(`${remote.cognitoDomain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: remote.cognitoCliClientId!,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const json = (await res.json()) as Record<string, string | number>;
  if (!res.ok) {
    throw new Error(`token exchange failed: ${json.error ?? res.status}`);
  }
  const idToken = String(json.id_token);
  const claims = decodeJwtPayload(idToken);
  return {
    idToken,
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : null,
    expiresAt: Date.now() + Number(json.expires_in) * 1000,
    email: typeof claims.email === "string" ? claims.email : "",
    cognitoDomain: remote.cognitoDomain!,
    cognitoClientId: remote.cognitoCliClientId!,
    region: remote.region,
  };
}

/** Browser-based login: authorization code + PKCE against the Cognito Hosted UI. */
export async function loginWithBrowser(): Promise<StoredCredentials> {
  const config = loadCliConfig();
  const remote = await fetchRemoteConfig(config);
  if (!remote.cognitoDomain || !remote.cognitoCliClientId) {
    throw new Error("the API did not provide Cognito configuration (is it deployed?)");
  }

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = `http://localhost:${LOOPBACK_PORT}/callback`;

  const params = new URLSearchParams({
    client_id: remote.cognitoCliClientId,
    response_type: "code",
    scope: "email openid profile",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  const authorizeUrl = `${remote.cognitoDomain}/oauth2/authorize?${params.toString()}`;

  console.log("Opening your browser to sign in...");
  console.log(`If the browser does not open, visit:\n  ${authorizeUrl}\n`);
  const loopback = waitForLoopbackCode();
  openBrowser(authorizeUrl);

  let code = (await loopback)?.code;
  if (!code) {
    // Headless / blocked port fallback: paste the redirect URL manually
    const pasted = await promptLine("Paste the full redirect URL (or the code= value): ");
    code = pasted.includes("code=") ? (new URL(pasted).searchParams.get("code") ?? "") : pasted;
  }
  if (!code) throw new Error("no authorization code received");

  const credentials = await exchangeCode(remote, code, verifier, redirectUri);
  saveCredentials(credentials);
  return credentials;
}

/** Non-interactive email/password login (E2E and scripting). */
export async function loginWithPassword(
  email: string,
  password: string,
): Promise<StoredCredentials> {
  const config = loadCliConfig();
  const remote = await fetchRemoteConfig(config);
  if (!remote.cognitoCliClientId) {
    throw new Error("the API did not provide Cognito configuration (is it deployed?)");
  }
  const res = await fetch(`https://cognito-idp.${remote.region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: remote.cognitoCliClientId,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  });
  const json = (await res.json()) as {
    message?: string;
    AuthenticationResult?: {
      IdToken: string;
      AccessToken: string;
      RefreshToken?: string;
      ExpiresIn: number;
    };
  };
  if (!res.ok || !json.AuthenticationResult) {
    throw new Error(json.message ?? "authentication failed");
  }
  const result = json.AuthenticationResult;
  const claims = decodeJwtPayload(result.IdToken);
  const credentials: StoredCredentials = {
    idToken: result.IdToken,
    accessToken: result.AccessToken,
    refreshToken: result.RefreshToken ?? null,
    expiresAt: Date.now() + result.ExpiresIn * 1000,
    email: typeof claims.email === "string" ? claims.email : email,
    cognitoDomain: remote.cognitoDomain ?? "",
    cognitoClientId: remote.cognitoCliClientId,
    region: remote.region,
  };
  saveCredentials(credentials);
  return credentials;
}

async function refresh(credentials: StoredCredentials): Promise<StoredCredentials | null> {
  if (!credentials.refreshToken) return null;
  const res = await fetch(`https://cognito-idp.${credentials.region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: credentials.cognitoClientId,
      AuthParameters: { REFRESH_TOKEN: credentials.refreshToken },
    }),
  });
  const json = (await res.json()) as {
    AuthenticationResult?: { IdToken: string; AccessToken: string; ExpiresIn: number };
  };
  if (!res.ok || !json.AuthenticationResult) return null;
  const updated: StoredCredentials = {
    ...credentials,
    idToken: json.AuthenticationResult.IdToken,
    accessToken: json.AuthenticationResult.AccessToken,
    expiresAt: Date.now() + json.AuthenticationResult.ExpiresIn * 1000,
  };
  saveCredentials(updated);
  return updated;
}

/** Returns a bearer token for API calls, refreshing when close to expiry. */
export async function getBearerToken(): Promise<string> {
  const config = loadCliConfig();
  if (config.bypassToken) return config.bypassToken;

  let credentials = readStoredCredentials();
  if (!credentials?.idToken || credentials.idToken === undefined) {
    throw new Error("not logged in — run `skill-book login` first");
  }
  if (credentials.expiresAt - Date.now() < 60_000) {
    credentials = await refresh(credentials);
    if (!credentials) {
      throw new Error("session expired — run `skill-book login` again");
    }
  }
  return credentials.idToken;
}
