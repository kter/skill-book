import { handle } from "hono/aws-lambda";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb, createPool } from "./db/client.js";
import { S3Storage } from "./storage/s3.js";

const config = loadConfig();

if (!config.artifactsBucket) {
  throw new Error("ARTIFACTS_BUCKET is required in Lambda");
}

const pool = createPool({
  dsqlClusterEndpoint: config.dsqlClusterEndpoint,
  databaseUrl: config.databaseUrl,
  awsRegion: config.awsRegion,
  max: 1,
});
const db = createDb(pool);
const storage = new S3Storage(config.artifactsBucket, config.awsRegion);

const app = createApp({ config, db, storage });

export const handler = handle(app);
