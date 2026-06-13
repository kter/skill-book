import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import pg from "pg";
import { createZip, type ZipEntry } from "@skill-book/shared/zip";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb, type Db } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { clearUserCache } from "../src/middleware/auth.js";
import { LocalStorage } from "../src/storage/local.js";

export interface TestContext {
  app: Hono;
  db: Db;
  pool: pg.Pool;
  storageDir: string;
  cleanup: () => Promise<void>;
}

const enc = new TextEncoder();

export async function createTestContext(): Promise<TestContext> {
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://skillbook:skillbook@localhost:5433/skillbook";
  const schema = `test_${Math.random().toString(36).slice(2, 10)}`;

  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 4,
    options: `-c search_path=${schema}`,
  });
  const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
  await migrate(pool, migrationsDir, false);

  const db = createDb(pool);
  const storageDir = await mkdtemp(path.join(tmpdir(), "skill-book-storage-"));
  const storage = new LocalStorage(storageDir, "http://test.local");
  const config = loadConfig({
    ENVIRONMENT: "local",
    DATABASE_URL: databaseUrl,
    CORS_ORIGINS: "http://localhost:3000",
  } as NodeJS.ProcessEnv);

  clearUserCache();
  const app = createApp({ config, db, storage });

  return {
    app,
    db,
    pool,
    storageDir,
    cleanup: async () => {
      const admin2 = new pg.Pool({ connectionString: databaseUrl, max: 1 });
      await admin2.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin2.end();
      await pool.end();
      await rm(storageDir, { recursive: true, force: true });
    },
  };
}

export function asUser(name: string): Record<string, string> {
  return { "x-dev-user": name, "content-type": "application/json" };
}

export function makeZipBuffer(files: Record<string, string>): Uint8Array {
  const entries: ZipEntry[] = Object.entries(files).map(([p, content]) => ({
    path: p,
    data: enc.encode(content),
  }));
  return createZip(entries);
}

export const VALID_SKILL_MD = (name: string) => `---
name: ${name}
description: A test skill that does useful things
---

# ${name}

Use this skill for testing.
`;

/** Stage a zip through the same flow the clients use, returning the staging key. */
export async function stageZip(app: Hono, user: string, zip: Uint8Array): Promise<string> {
  const uploadRes = await app.request("/v1/uploads", { method: "POST", headers: asUser(user) });
  if (uploadRes.status !== 201) throw new Error(`uploads failed: ${uploadRes.status}`);
  const { key, url } = (await uploadRes.json()) as { key: string; url: string };
  const putPath = url.replace("http://test.local", "");
  const putRes = await app.request(putPath, {
    method: "PUT",
    body: zip.buffer as ArrayBuffer,
  });
  if (putRes.status !== 200) throw new Error(`staging PUT failed: ${putRes.status}`);
  return key;
}

export async function createAndPublish(
  app: Hono,
  user: string,
  name: string,
  options: { type?: string; files?: Record<string, string>; tags?: string[] } = {},
): Promise<Response> {
  const type = options.type ?? "CLAUDE_SKILL";
  const files = options.files ?? { "SKILL.md": VALID_SKILL_MD(name) };
  const createRes = await app.request("/v1/artifacts", {
    method: "POST",
    headers: asUser(user),
    body: JSON.stringify({
      name,
      type,
      description: `${name} description`,
      tags: options.tags ?? [],
    }),
  });
  if (createRes.status !== 201) return createRes;
  const stagingKey = await stageZip(app, user, makeZipBuffer(files));
  return app.request(`/v1/artifacts/${name}/versions`, {
    method: "POST",
    headers: asUser(user),
    body: JSON.stringify({ stagingKey }),
  });
}
