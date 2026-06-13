import { DsqlSigner } from "@aws-sdk/dsql-signer";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

export interface DbOptions {
  databaseUrl?: string;
  dsqlClusterEndpoint?: string;
  awsRegion?: string;
  /** Extra schema search_path (used by tests for isolation). */
  searchPath?: string;
  max?: number;
}

export function dsqlHostname(endpointOrIdentifier: string, region: string): string {
  return endpointOrIdentifier.includes(".")
    ? endpointOrIdentifier
    : `${endpointOrIdentifier}.dsql.${region}.on.aws`;
}

export function createPool(options: DbOptions): pg.Pool {
  const { dsqlClusterEndpoint, databaseUrl, awsRegion = "ap-northeast-1" } = options;

  if (dsqlClusterEndpoint) {
    const hostname = dsqlHostname(dsqlClusterEndpoint, awsRegion);
    const signer = new DsqlSigner({ hostname, region: awsRegion });
    return new pg.Pool({
      host: hostname,
      port: 5432,
      database: "postgres",
      user: "admin",
      // Tokens are short-lived; pg invokes this per new connection.
      password: () => signer.getDbConnectAdminAuthToken(),
      ssl: true,
      max: options.max ?? 1,
      idleTimeoutMillis: 30_000,
    });
  }

  if (!databaseUrl) {
    throw new Error("either DSQL_CLUSTER_ENDPOINT or DATABASE_URL must be set");
  }
  return new pg.Pool({
    connectionString: databaseUrl,
    max: options.max ?? 4,
    options: options.searchPath ? `-c search_path=${options.searchPath}` : undefined,
  });
}

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema });
}
