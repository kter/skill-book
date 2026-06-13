import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Explainer } from "./ai/explainer.js";
import type { ApiConfig } from "./config.js";
import type { Db } from "./db/client.js";
import { artifactTags } from "./db/schema.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createArtifactsRouter } from "./routes/artifacts.js";
import type { Storage } from "./storage/index.js";
import { ObjectNotFoundError } from "./storage/index.js";

export interface AppDeps {
  config: ApiConfig;
  db: Db;
  storage: Storage;
  explainer: Explainer;
}

export function createApp({ config, db, storage, explainer }: AppDeps): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true, environment: config.environment }));

  // Public client configuration (public-client IDs only — not secrets).
  app.get("/config", (c) =>
    c.json({
      environment: config.environment,
      region: config.awsRegion,
      cognitoUserPoolId: config.cognitoUserPoolId ?? null,
      cognitoDomain: config.cognitoDomain ?? null,
      cognitoCliClientId: config.cognitoCliClientId ?? null,
    }),
  );

  app.use(
    "/v1/*",
    cors({
      origin: config.corsOrigins,
      allowHeaders: ["Authorization", "Content-Type", "X-Dev-User"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  // Local-only storage emulation: presigned URLs point here (no auth — local dev/test only).
  if (config.environment === "local") {
    app.put("/v1/local-storage/*", async (c) => {
      const key = c.req.path.replace("/v1/local-storage/", "");
      const body = new Uint8Array(await c.req.arrayBuffer());
      await storage.putObject(key, body, "application/zip");
      return c.body(null, 200);
    });
    app.get("/v1/local-storage/*", async (c) => {
      const key = c.req.path.replace("/v1/local-storage/", "");
      try {
        const data = await storage.getObject(key);
        const download = c.req.query("download");
        if (download) {
          c.header("Content-Disposition", `attachment; filename="${download}"`);
        }
        c.header("Content-Type", "application/zip");
        return c.body(data.buffer as ArrayBuffer);
      } catch (err) {
        if (err instanceof ObjectNotFoundError) return c.json({ error: "not found" }, 404);
        throw err;
      }
    });
  }

  app.use("/v1/*", createAuthMiddleware(config, db));

  app.get("/v1/me", (c) => {
    const user = c.get("user");
    return c.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    });
  });

  app.post("/v1/uploads", async (c) => {
    const user = c.get("user");
    const key = `staging/${user.id}/${randomUUID()}.zip`;
    const upload = await storage.createStagingUploadUrl(key);
    return c.json(upload, 201);
  });

  app.get("/v1/tags", async (c) => {
    const rows = await db
      .selectDistinct({ tag: artifactTags.tag })
      .from(artifactTags)
      .orderBy(artifactTags.tag);
    return c.json({ tags: rows.map((r) => r.tag) });
  });

  app.route("/v1/artifacts", createArtifactsRouter({ db, storage, config, explainer }));

  app.onError((err, c) => {
    console.error("unhandled error:", err);
    return c.json({ error: "internal server error" }, 500);
  });

  return app;
}
