-- skill-book initial schema.
-- DSQL constraints: no FK constraints, no SERIAL, one DDL per transaction,
-- secondary/unique indexes via CREATE INDEX ASYNC (rewritten to plain
-- CREATE INDEX by the migration runner when running against local Postgres).

CREATE TABLE users (
  id UUID PRIMARY KEY,
  cognito_sub VARCHAR(128) NOT NULL,
  email VARCHAR(320) NOT NULL,
  display_name VARCHAR(256),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ASYNC users_cognito_sub_uq ON users (cognito_sub);

CREATE TABLE artifacts (
  id UUID PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  type VARCHAR(16) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_user_id UUID NOT NULL,
  forked_from_artifact_id UUID,
  latest_version INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ASYNC artifacts_name_uq ON artifacts (name);

CREATE INDEX ASYNC artifacts_owner_idx ON artifacts (owner_user_id);

CREATE TABLE artifact_tags (
  artifact_id UUID NOT NULL,
  tag VARCHAR(64) NOT NULL,
  PRIMARY KEY (artifact_id, tag)
);

CREATE INDEX ASYNC artifact_tags_tag_idx ON artifact_tags (tag);

CREATE TABLE artifact_versions (
  id UUID PRIMARY KEY,
  artifact_id UUID NOT NULL,
  version INTEGER NOT NULL,
  status VARCHAR(16) NOT NULL,
  zip_key VARCHAR(512),
  content_text TEXT,
  file_list TEXT,
  total_size_bytes BIGINT NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX ASYNC artifact_versions_uq ON artifact_versions (artifact_id, version);

CREATE TABLE scan_findings (
  id UUID PRIMARY KEY,
  version_id UUID NOT NULL,
  rule_id VARCHAR(64) NOT NULL,
  file_path VARCHAR(512) NOT NULL,
  line_number INTEGER NOT NULL,
  fingerprint VARCHAR(128) NOT NULL,
  masked_match VARCHAR(256) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC scan_findings_version_idx ON scan_findings (version_id);

CREATE TABLE scan_overrides (
  id UUID PRIMARY KEY,
  artifact_id UUID NOT NULL,
  fingerprint VARCHAR(128) NOT NULL,
  reason TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ASYNC scan_overrides_uq ON scan_overrides (artifact_id, fingerprint);

CREATE TABLE ratings (
  id UUID PRIMARY KEY,
  artifact_id UUID NOT NULL,
  user_id UUID NOT NULL,
  stars SMALLINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ASYNC ratings_uq ON ratings (artifact_id, user_id);

CREATE TABLE download_events (
  id UUID PRIMARY KEY,
  artifact_id UUID NOT NULL,
  version_id UUID NOT NULL,
  user_id UUID,
  client VARCHAR(8) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC download_events_artifact_idx ON download_events (artifact_id);
