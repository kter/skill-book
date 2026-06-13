"use client";

import { cognitoRegion, config } from "./config";

const STORAGE_KEY = "skill-book.auth";
const PKCE_VERIFIER_KEY = "skill-book.pkce-verifier";

export interface Session {
  idToken: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number; // epoch ms
  email: string;
}

interface CognitoAuthResult {
  IdToken: string;
  AccessToken: string;
  RefreshToken?: string;
  ExpiresIn: number;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1] ?? "";
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return {};
  }
}

function storeSession(result: CognitoAuthResult, existingRefreshToken?: string | null): Session {
  const claims = decodeJwtPayload(result.IdToken);
  const session: Session = {
    idToken: result.IdToken,
    accessToken: result.AccessToken,
    refreshToken: result.RefreshToken ?? existingRefreshToken ?? null,
    expiresAt: Date.now() + result.ExpiresIn * 1000,
    email: typeof claims.email === "string" ? claims.email : "",
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function getStoredSession(): Session | null {
  if (typeof window === "undefined") return null;
  if (config.devAuthBypass) {
    return {
      idToken: "bypass",
      accessToken: "bypass",
      refreshToken: null,
      expiresAt: Date.now() + 86_400_000,
      email: "dev-user@local.test",
    };
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function signOut() {
  localStorage.removeItem(STORAGE_KEY);
}

async function cognitoIdpCall<T>(target: string, body: unknown): Promise<T> {
  const res = await fetch(`https://cognito-idp.${cognitoRegion()}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.message ?? json.__type ?? "authentication failed");
  }
  return json as T;
}

/** Email/password sign-in via USER_PASSWORD_AUTH (used by humans without Google and by E2E). */
export async function signInWithPassword(email: string, password: string): Promise<Session> {
  const result = await cognitoIdpCall<{ AuthenticationResult?: CognitoAuthResult }>(
    "InitiateAuth",
    {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: config.cognitoClientId,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    },
  );
  if (!result.AuthenticationResult) {
    throw new Error("unsupported auth challenge — contact the administrator");
  }
  return storeSession(result.AuthenticationResult);
}

async function refreshSession(session: Session): Promise<Session | null> {
  if (!session.refreshToken) return null;
  try {
    const result = await cognitoIdpCall<{ AuthenticationResult?: CognitoAuthResult }>(
      "InitiateAuth",
      {
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: config.cognitoClientId,
        AuthParameters: { REFRESH_TOKEN: session.refreshToken },
      },
    );
    if (!result.AuthenticationResult) return null;
    return storeSession(result.AuthenticationResult, session.refreshToken);
  } catch {
    return null;
  }
}

export async function getValidSession(): Promise<Session | null> {
  const session = getStoredSession();
  if (!session) return null;
  if (config.devAuthBypass) return session;
  if (session.expiresAt - Date.now() > 60_000) return session;
  const refreshed = await refreshSession(session);
  if (!refreshed) signOut();
  return refreshed;
}

// ---- Google sign-in via Cognito Hosted UI (authorization code + PKCE) ----

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function startGoogleSignIn(): Promise<void> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64UrlEncode(verifierBytes);
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(new Uint8Array(digest));

  const params = new URLSearchParams({
    client_id: config.cognitoClientId,
    response_type: "code",
    scope: "email openid profile",
    redirect_uri: `${config.siteUrl}/auth/callback/`,
    identity_provider: "Google",
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  window.location.href = `${config.cognitoDomain}/oauth2/authorize?${params.toString()}`;
}

export async function completeGoogleSignIn(code: string): Promise<Session> {
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY) ?? "";
  const res = await fetch(`${config.cognitoDomain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.cognitoClientId,
      code,
      redirect_uri: `${config.siteUrl}/auth/callback/`,
      code_verifier: verifier,
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error ?? "token exchange failed");
  }
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  return storeSession({
    IdToken: json.id_token,
    AccessToken: json.access_token,
    RefreshToken: json.refresh_token,
    ExpiresIn: json.expires_in,
  });
}
