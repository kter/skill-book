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

// Naive splitter: statements are separated by a semicolon at end-of-line and
// full-line `--` comments are stripped. It deliberately does NOT understand
// semicolons inside string literals or dollar-quoted bodies (`$$ ... $$`), so
// migration files must keep one statement per `;\n` and avoid embedded
// semicolons. DSQL also forbids multi-statement transactions, which keeps
// migrations to simple, individually-runnable DDL anyway.
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
    // DSQL runs each DDL in its own transaction, so a migration file cannot be
    // applied atomically. We record per-statement progress: if the runner dies
    // mid-file it resumes from the next unapplied statement instead of replaying
    // the whole file (which would fail on already-created objects and wedge
    // migrations permanently). The narrow window — a statement committed but its
    // progress row not yet written — replays exactly that one statement on the
    // next run, so statements should be safe to re-run where practical.
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migration_progress (version VARCHAR(64) PRIMARY KEY, completed_steps INTEGER NOT NULL DEFAULT 0)",
    );
    const applied = new Set<string>(
      (await client.query("SELECT version FROM schema_migrations")).rows.map(
        (r: { version: string }) => r.version,
      ),
    );
    const progress = new Map<string, number>(
      (
        await client.query("SELECT version, completed_steps FROM schema_migration_progress")
      ).rows.map((r: { version: string; completed_steps: number }) => [
        r.version,
        r.completed_steps,
      ]),
    );

    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      const statements = splitStatements(sql);
      const done = progress.get(file) ?? 0;
      if (done > 0) {
        console.log(
          `Resuming migration ${file} from statement ${done + 1}/${statements.length}...`,
        );
      } else {
        console.log(`Applying migration ${file}...`);
      }
      for (let i = done; i < statements.length; i++) {
        await runStatement(client, statements[i]!, isDsql);
        if (i === 0) {
          await client.query(
            "INSERT INTO schema_migration_progress (version, completed_steps) VALUES ($1, 1)",
            [file],
          );
        } else {
          await client.query(
            "UPDATE schema_migration_progress SET completed_steps = $2 WHERE version = $1",
            [file, i + 1],
          );
        }
      }
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
      await client.query("DELETE FROM schema_migration_progress WHERE version = $1", [file]);
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
