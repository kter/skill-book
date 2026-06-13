import { serve } from "@hono/node-server";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb, createPool } from "./db/client.js";
import { LocalStorage } from "./storage/local.js";
import { S3Storage } from "./storage/s3.js";

const config = loadConfig();
const port = Number(process.env.PORT ?? 8000);

const pool = createPool({
  databaseUrl: config.databaseUrl,
  dsqlClusterEndpoint: config.dsqlClusterEndpoint,
  awsRegion: config.awsRegion,
  max: 4,
});
const db = createDb(pool);

const storage = config.artifactsBucket
  ? new S3Storage(config.artifactsBucket, config.awsRegion)
  : new LocalStorage(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.local-storage"),
      `http://localhost:${port}`,
    );

const app = createApp({ config, db, storage });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`skill-book api listening on http://localhost:${info.port}`);
});
