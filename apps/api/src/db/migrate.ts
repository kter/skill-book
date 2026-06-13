// Migration runner aware of Aurora DSQL's DDL constraints:
//  - one DDL statement per transaction (statements run individually, no BEGIN)
//  - secondary indexes only via CREATE INDEX ASYNC, which returns a job id
//    that must be polled in sys.jobs until completion
// Against local Postgres, "INDEX ASYNC" is rewritten to a plain "INDEX".

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { createPool } from "./client.js";

const ASYNC_INDEX_RE = /^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+ASYNC\s+/i;

export function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((s) => s.length > 0);
}

async function waitForDsqlJob(client: pg.PoolClient, jobId: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    const result = await client.query("SELECT status FROM sys.jobs WHERE job_id = $1", [jobId]);
    const status: string | undefined = result.rows[0]?.status;
    if (status === "completed") return;
    if (status === "failed") {
      throw new Error(`DSQL async index job ${jobId} failed`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`DSQL async index job ${jobId} did not complete in time`);
}

async function runStatement(client: pg.PoolClient, statement: string, isDsql: boolean) {
  if (!ASYNC_INDEX_RE.test(statement)) {
    await client.query(statement);
    return;
  }
  if (!isDsql) {
    await client.query(statement.replace(/INDEX\s+ASYNC/i, "INDEX"));
    return;
  }
  const result = await client.query(statement);
  const jobId: string | undefined = result.rows[0]?.job_id;
  if (jobId) {
    await waitForDsqlJob(client, jobId);
  }
}

export async function migrate(pool: pg.Pool, migrationsDir: string, isDsql: boolean) {
  const client = await pool.connect();
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(64) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const applied = new Set<string>(
      (await client.query("SELECT version FROM schema_migrations")).rows.map(
        (r: { version: string }) => r.version,
      ),
    );

    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      console.log(`Applying migration ${file}...`);
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      for (const statement of splitStatements(sql)) {
        await runStatement(client, statement, isDsql);
      }
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
      console.log(`Applied ${file}`);
    }
  } finally {
    client.release();
  }
}

async function main() {
  const dsqlClusterEndpoint = process.env.DSQL_CLUSTER_ENDPOINT || undefined;
  const pool = createPool({
    databaseUrl: process.env.DATABASE_URL,
    dsqlClusterEndpoint,
    awsRegion: process.env.AWS_REGION ?? "ap-northeast-1",
    max: 1,
  });
  const migrationsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../migrations",
  );
  try {
    await migrate(pool, migrationsDir, Boolean(dsqlClusterEndpoint));
    console.log("Migrations up to date.");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
