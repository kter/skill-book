import {
  bigint,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// NOTE: no .references() anywhere — Aurora DSQL does not support FK constraints;
// referential integrity is enforced in the service layer.

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  cognitoSub: varchar("cognito_sub", { length: 128 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  displayName: varchar("display_name", { length: 256 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const artifacts = pgTable("artifacts", {
  id: uuid("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  type: varchar("type", { length: 16 }).notNull(),
  description: text("description").notNull().default(""),
  ownerUserId: uuid("owner_user_id").notNull(),
  forkedFromArtifactId: uuid("forked_from_artifact_id"),
  latestVersion: integer("latest_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const artifactTags = pgTable(
  "artifact_tags",
  {
    artifactId: uuid("artifact_id").notNull(),
    tag: varchar("tag", { length: 64 }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.artifactId, table.tag] })],
);

export const artifactVersions = pgTable("artifact_versions", {
  id: uuid("id").primaryKey(),
  artifactId: uuid("artifact_id").notNull(),
  version: integer("version").notNull(),
  status: varchar("status", { length: 16 }).notNull(),
  zipKey: varchar("zip_key", { length: 512 }),
  contentText: text("content_text"),
  fileList: text("file_list"),
  totalSizeBytes: bigint("total_size_bytes", { mode: "number" }).notNull().default(0),
  fileCount: integer("file_count").notNull().default(0),
  message: text("message"),
  explanation: text("explanation"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

export const scanFindings = pgTable("scan_findings", {
  id: uuid("id").primaryKey(),
  versionId: uuid("version_id").notNull(),
  ruleId: varchar("rule_id", { length: 64 }).notNull(),
  filePath: varchar("file_path", { length: 512 }).notNull(),
  lineNumber: integer("line_number").notNull(),
  fingerprint: varchar("fingerprint", { length: 128 }).notNull(),
  maskedMatch: varchar("masked_match", { length: 256 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scanOverrides = pgTable("scan_overrides", {
  id: uuid("id").primaryKey(),
  artifactId: uuid("artifact_id").notNull(),
  fingerprint: varchar("fingerprint", { length: 128 }).notNull(),
  reason: text("reason").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ratings = pgTable("ratings", {
  id: uuid("id").primaryKey(),
  artifactId: uuid("artifact_id").notNull(),
  userId: uuid("user_id").notNull(),
  stars: smallint("stars").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const downloadEvents = pgTable("download_events", {
  id: uuid("id").primaryKey(),
  artifactId: uuid("artifact_id").notNull(),
  versionId: uuid("version_id").notNull(),
  userId: uuid("user_id"),
  client: varchar("client", { length: 8 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
