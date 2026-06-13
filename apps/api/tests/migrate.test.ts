import { describe, expect, it } from "vitest";
import { splitStatements } from "../src/db/migrate.js";

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
