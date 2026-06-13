import { CognitoJwtVerifier } from "aws-jwt-verify";
import { emailDomainNotAllowedMessage, isEmailDomainAllowed } from "@skill-book/shared/auth";
import { eq } from "drizzle-orm";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { ApiConfig } from "../config.js";
import type { Db } from "../db/client.js";
import { users } from "../db/schema.js";

export interface AuthUser {
  id: string;
  cognitoSub: string;
  email: string;
  displayName: string | null;
}

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

interface TokenClaims {
  sub: string;
  email: string;
  name?: string;
}

// Per-container cache: cognito sub -> resolved user row
const userCache = new Map<string, AuthUser>();

/** Constant-time string equality. `timingSafeEqual` throws on length mismatch,
 *  so hash both sides to fixed-length buffers first (the hash isn't secret —
 *  it just equalizes length while keeping the compare timing-independent). */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function upsertUser(db: Db, claims: TokenClaims): Promise<AuthUser> {
  const cached = userCache.get(claims.sub);
  if (cached) return cached;

  const existing = await db.select().from(users).where(eq(users.cognitoSub, claims.sub)).limit(1);
  let row = existing[0];
  if (!row) {
    const inserted = await db
      .insert(users)
      .values({
        id: randomUUID(),
        cognitoSub: claims.sub,
        email: claims.email,
        displayName: claims.name ?? claims.email.split("@")[0] ?? null,
      })
      .returning();
    row = inserted[0]!;
  }
  const user: AuthUser = {
    id: row.id,
    cognitoSub: row.cognitoSub,
    email: row.email,
    displayName: row.displayName,
  };
  userCache.set(claims.sub, user);
  return user;
}

/** Test helper: drop the per-container user cache. */
export function clearUserCache() {
  userCache.clear();
}

export function createAuthMiddleware(config: ApiConfig, db: Db): MiddlewareHandler {
  const verifier =
    config.cognitoUserPoolId && config.cognitoClientIds.length > 0
      ? CognitoJwtVerifier.create({
          userPoolId: config.cognitoUserPoolId,
          tokenUse: "id",
          clientId: config.cognitoClientIds,
        })
      : null;

  return async (c, next) => {
    // Local development: trust a synthetic user header (never enabled in deployed envs).
    if (config.environment === "local") {
      const devUser = c.req.header("x-dev-user") ?? "dev-user";
      const safe = devUser.replace(/[^\w.-]/g, "").slice(0, 64) || "dev-user";
      const user = await upsertUser(db, {
        sub: `local-${safe}`,
        email: `${safe}@local.test`,
        name: safe,
      });
      c.set("user", user);
      return next();
    }

    const authHeader = c.req.header("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return c.json({ error: "missing bearer token" }, 401);
    }

    // Integration-test bypass (dev only; tokens injected via Terraform/SSM).
    // Constant-time comparison so a token can't be recovered by timing the
    // string compare `indexOf` would do.
    const bypassIndex = config.integrationBypassTokens.findIndex((t) =>
      timingSafeEqualStr(t, token),
    );
    if (bypassIndex >= 0) {
      const user = await upsertUser(db, {
        sub: `integration-test-${bypassIndex + 1}`,
        email: `integration-test-${bypassIndex + 1}@skill-book.invalid`,
        name: `integration-test-${bypassIndex + 1}`,
      });
      c.set("user", user);
      return next();
    }

    if (!verifier) {
      return c.json({ error: "auth is not configured" }, 500);
    }

    try {
      const payload = await verifier.verify(token);
      const email = typeof payload.email === "string" ? payload.email : null;
      if (!email) {
        return c.json({ error: "token has no email claim (use the ID token)" }, 401);
      }
      // Email-domain whitelist (defense in depth — the Cognito pre-sign-up
      // Lambda blocks registration; this also blocks any non-whitelisted token).
      if (!isEmailDomainAllowed(email)) {
        return c.json({ error: emailDomainNotAllowedMessage() }, 403);
      }
      const user = await upsertUser(db, {
        sub: payload.sub,
        email,
        name: typeof payload.name === "string" ? payload.name : undefined,
      });
      c.set("user", user);
      return next();
    } catch {
      return c.json({ error: "invalid token" }, 401);
    }
  };
}
