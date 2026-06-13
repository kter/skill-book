# AGENTS.md

Repository instructions for AI coding agents (Claude Code, Codex, etc.).

## What this is

skill-book — an internal registry for sharing Claude Skills, CLAUDE.md, and AGENTS.md files
across an organization. Typed artifacts, secrets scanning on upload (block on findings),
owner-only updates with immutable version history, fork lineage, star ratings, download counts.

Stack: TypeScript monorepo (npm workspaces) — Hono on Lambda (API Gateway HTTP API),
Next.js static export on S3+CloudFront, Aurora DSQL (local substitute: docker Postgres 16),
Cognito (email/password + Google IdP). Infra: Terraform with S3 remote state.

## Shared rules

- **Use the root `Makefile` for all commands.** Never run raw `terraform apply`, `aws s3 sync`,
  or ad-hoc deploy commands — use the make targets.
- Tool versions are pinned in `mise.toml`; run via mise (direnv activates it).
- **Deploy only to `dev`** (`ENV=dev`, AWS profile `dev`). prd is the company account and is
  NOT deployed from this machine.
- Always add tests: unit tests for shared/cli/api changes, Playwright E2E for user-facing flows.
- DSQL constraints: no FK constraints, no SERIAL, one DDL per transaction, `CREATE INDEX ASYNC`
  only. Migrations are plain SQL in `apps/api/migrations/` run by `src/db/migrate.ts`.
- Never store raw secrets in scan findings — masked matches and fingerprints only.
- The CLI must never write outside the explicit install target and its own config dir.

## Common commands

- `make install` / `make install-hooks` — npm deps, lefthook git hooks
- `make dev-stack` — local API (:8000) + web (:3000) with auth bypass + docker Postgres (:5433)
- `make test` — unit tests + lint (fast default)
- `make test-api` — API handler tests against docker Postgres
- `make test-e2e-local` / `make test-e2e-dev ENV=dev` — Playwright
- `make tf-plan ENV=dev` — terraform plan + conftest policy check
- `make deploy ENV=dev` — full deploy (API, migrations, frontend, integration tests)
