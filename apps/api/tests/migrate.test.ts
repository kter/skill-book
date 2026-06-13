import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { migrate, splitStatements } from "../src/db/migrate.js";

/** In-memory stand-in for a pg pool that records every migration DDL execution
 *  and rejects replaying an already-executed statement (mimicking "relation
 *  already exists"). `failOnDdlCount` makes the Nth DDL throw once, simulating a
 *  mid-file crash. */
function fakePool(opts: { failOnDdlCount?: number } = {}) {
  const appliedVersions = new Set<string>();
  const progressRows = new Map<string, number>();
  const ddlExecCount = new Map<string, number>();
  let ddlSeen = 0;

  const query = async (text: string, params?: unknown[]) => {
    if (text.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) return { rows: [] };
    if (text.startsWith("CREATE TABLE IF NOT EXISTS schema_migration_progress"))
      return { rows: [] };
    if (text === "SELECT version FROM schema_migrations") {
      return { rows: [...appliedVersions].map((version) => ({ version })) };
    }
    if (text.startsWith("SELECT version, completed_steps FROM schema_migration_progress")) {
      return {
        rows: [...progressRows].map(([version, completed_steps]) => ({ version, completed_steps })),
      };
    }
    if (text.startsWith("INSERT INTO schema_migration_progress")) {
      progressRows.set(params![0] as string, 1);
      return { rows: [] };
    }
    if (text.startsWith("UPDATE schema_migration_progress")) {
      progressRows.set(params![0] as string, params![1] as number);
      return { rows: [] };
    }
    if (text.startsWith("INSERT INTO schema_migrations")) {
      appliedVersions.add(params![0] as string);
      return { rows: [] };
    }
    if (text.startsWith("DELETE FROM schema_migration_progress")) {
      progressRows.delete(params![0] as string);
      return { rows: [] };
    }
    // Otherwise it's a migration DDL statement.
    ddlSeen += 1;
    if (opts.failOnDdlCount === ddlSeen) {
      opts.failOnDdlCount = undefined; // fail only once
      throw new Error("simulated crash mid-migration");
    }
    const seen = (ddlExecCount.get(text) ?? 0) + 1;
    ddlExecCount.set(text, seen);
    if (seen > 1) throw new Error(`statement replayed (relation already exists): ${text}`);
    return { rows: [] };
  };

  const client = { query, release: () => {} } as unknown as pg.PoolClient;
  const pool = { connect: async () => client } as unknown as pg.Pool;
  return { pool, appliedVersions, progressRows, ddlExecCount };
}

describe("splitStatements", () => {
  it("splits on trailing semicolons and strips comments", () => {
    const sql = `-- a comment
CREATE TABLE a (id UUID PRIMARY KEY);

-- another
CREATE INDEX ASYNC a_idx ON a (id);
`;
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(/^CREATE TABLE a/);
    expect(statements[1]).toMatch(/^CREATE INDEX ASYNC/);
  });

  it("keeps multi-line statements intact", () => {
    const sql = `CREATE TABLE b (
  id UUID PRIMARY KEY,
  name VARCHAR(10)
);`;
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("VARCHAR(10)");
  });

  it("returns nothing for comment-only input", () => {
    expect(splitStatements("-- only a comment\n")).toEqual([]);
  });

  it("parses the real initial migration into individual statements", async () => {
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile(new URL("../migrations/0001_init.sql", import.meta.url), "utf8");
    const statements = splitStatements(sql);
    // every statement is a single CREATE, none contain a stray semicolon
    expect(statements.length).toBeGreaterThan(10);
    for (const statement of statements) {
      expect(statement).toMatch(/^CREATE /);
    }
  });
});

describe("migrate resumability", () => {
  let dir: string;
  const file = "0001_test.sql";

  async function writeMigration() {
    dir = await mkdtemp(path.join(tmpdir(), "skillbook-mig-"));
    await writeFile(
      path.join(dir, file),
      [
        "CREATE TABLE a (id UUID PRIMARY KEY);",
        "CREATE TABLE b (id UUID PRIMARY KEY);",
        "CREATE TABLE c (id UUID PRIMARY KEY);",
        "CREATE TABLE d (id UUID PRIMARY KEY);",
        "",
      ].join("\n"),
    );
  }

  it("resumes from the failed statement without replaying applied ones", async () => {
    await writeMigration();
    try {
      const store = fakePool({ failOnDdlCount: 3 });

      // First run crashes on the 3rd statement: 2 applied, file not recorded.
      await expect(migrate(store.pool, dir, false)).rejects.toThrow("simulated crash");
      expect(store.progressRows.get(file)).toBe(2);
      expect(store.appliedVersions.has(file)).toBe(false);

      // Second run resumes; if it replayed an applied statement the fake throws.
      await migrate(store.pool, dir, false);
      expect(store.appliedVersions.has(file)).toBe(true);
      expect(store.progressRows.has(file)).toBe(false);
      // Every statement executed exactly once across both runs.
      for (const count of store.ddlExecCount.values()) expect(count).toBe(1);
      expect(store.ddlExecCount.size).toBe(4);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips a migration already recorded in schema_migrations", async () => {
    await writeMigration();
    try {
      const store = fakePool();
      store.appliedVersions.add(file);
      await migrate(store.pool, dir, false);
      expect(store.ddlExecCount.size).toBe(0); // nothing re-run
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
