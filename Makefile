# skill-book Makefile
# Single entry point for development, testing, and deployment tasks

# Configuration
ENV ?= dev

# Disable AWS CLI pager to prevent interactive pager from launching
export AWS_PAGER=

# Disable Terraform interactive input prompts
export TF_INPUT=0

# Resolve tools via mise shims so targets work in non-interactive shells
# (git hooks, agents) that haven't run the direnv/mise activation.
export PATH := $(HOME)/.local/share/mise/shims:$(PATH)
CONFTEST ?= $(shell mise which conftest 2>/dev/null || echo conftest)

# Use ENV as the default profile, but allow override from command line
AWS_PROFILE = $(ENV)
AWS_REGION ?= ap-northeast-1

AWS_ACCOUNT_ID = $(shell aws sts get-caller-identity --profile $(AWS_PROFILE) --query Account --output text 2>/dev/null)
OPTIONAL_SSM_PARAMETER_SCRIPT := ./scripts/get_optional_ssm_parameter.sh
LOCAL_DATABASE_URL ?= postgresql://skillbook:skillbook@localhost:5433/skillbook

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-22s\033[0m %s\n", $$1, $$2}'

# =============================================================================
# Development
# =============================================================================

.PHONY: install
install: ## Install npm dependencies for all workspaces
	npm install

.PHONY: db-up
db-up: ## Start local Postgres (DSQL substitute) via docker compose
	docker compose up -d db
	@until docker compose exec db pg_isready -U skillbook >/dev/null 2>&1; do sleep 1; done
	@echo "Local Postgres ready on :5433"

.PHONY: db-down
db-down: ## Stop local Postgres
	docker compose down

.PHONY: db-migrate
db-migrate: db-up ## Apply database migrations to local Postgres
	cd apps/api && DATABASE_URL=$(LOCAL_DATABASE_URL) npx tsx src/db/migrate.ts

.PHONY: db-migrate-dev
db-migrate-dev: tf-switch ## Apply database migrations to the deployed DSQL cluster (ENV=dev)
	$(eval DSQL_ENDPOINT := $(shell cd terraform && AWS_PROFILE=$(AWS_PROFILE) terraform output -raw dsql_endpoint))
	cd apps/api && \
	  AWS_PROFILE=$(AWS_PROFILE) AWS_REGION=$(AWS_REGION) \
	  DSQL_CLUSTER_ENDPOINT=$(DSQL_ENDPOINT) \
	  npx tsx src/db/migrate.ts

.PHONY: dev-api
dev-api: db-migrate ## Run the API locally on :8000 (ENVIRONMENT=local, local Postgres)
	cd apps/api && \
	  ENVIRONMENT=local \
	  DATABASE_URL=$(LOCAL_DATABASE_URL) \
	  CORS_ORIGINS=http://localhost:3000 \
	  PORT=8000 \
	  npx tsx watch src/local.ts

.PHONY: dev-web
dev-web: ## Run the web frontend locally on :3000 with auth bypass
	cd apps/web && \
	  NEXT_PUBLIC_API_URL=http://localhost:8000 \
	  NEXT_PUBLIC_ENVIRONMENT=local \
	  NEXT_PUBLIC_DEV_AUTH_BYPASS=true \
	  npm run dev

.PHONY: dev-stack
dev-stack: db-migrate ## Run API (8000) + web (3000) with auth bypass against local Postgres
	@echo "Starting local dev stack:"
	@echo "  api -> http://localhost:8000 (ENVIRONMENT=local, Postgres :5433)"
	@echo "  web -> http://localhost:3000 (DEV_AUTH_BYPASS=true)"
	@echo "Press Ctrl-C to stop both."
	@trap 'kill 0' INT TERM EXIT; \
	  ( cd apps/api && \
	    ENVIRONMENT=local \
	    DATABASE_URL=$(LOCAL_DATABASE_URL) \
	    CORS_ORIGINS=http://localhost:3000 \
	    PORT=8000 \
	    npx tsx watch src/local.ts ) & \
	  ( cd apps/web && \
	    NEXT_PUBLIC_API_URL=http://localhost:8000 \
	    NEXT_PUBLIC_ENVIRONMENT=local \
	    NEXT_PUBLIC_DEV_AUTH_BYPASS=true \
	    npm run dev ) & \
	  wait

# =============================================================================
# Build & Deployment
# =============================================================================

.PHONY: build-shared
build-shared: ## Build the shared package (consumed by api/web/cli)
	cd packages/shared && npm run build

.PHONY: build-api
build-api: build-shared ## Bundle the API into a Lambda zip via esbuild
	cd apps/api && npm run build
	@echo "Lambda bundle: apps/api/dist/lambda.zip"

.PHONY: deploy-api
deploy-api: build-api tf-switch ## Build and deploy the API Lambda via Terraform
	cd terraform && AWS_PROFILE=$(AWS_PROFILE) terraform apply -auto-approve
	@echo "API deployed!"

.PHONY: build-frontend
build-frontend: tf-switch build-shared ## Build frontend for the selected environment
	$(eval API_URL := $(shell cd terraform && AWS_PROFILE=$(AWS_PROFILE) terraform output -raw api_url))
	$(eval COGNITO_USER_POOL_ID := $(shell cd terraform && AWS_PROFILE=$(AWS_PROFILE) terraform output -raw cognito_user_pool_id))
	$(eval COGNITO_CLIENT_ID := $(shell cd terraform && AWS_PROFILE=$(AWS_PROFILE) terraform output -raw cognito_web_client_id))
	$(eval COGNITO_DOMAIN := $(shell cd terraform && AWS_PROFILE=$(AWS_PROFILE) terraform output -raw cognito_domain))
	$(eval WEBSITE_URL := $(shell cd terraform && AWS_PROFILE=$(AWS_PROFILE) terraform output -raw website_url))
	cd apps/web && \
	  NEXT_PUBLIC_API_URL=$(API_URL) \
	  NEXT_PUBLIC_ENVIRONMENT=$(ENV) \
	  NEXT_PUBLIC_COGNITO_USER_POOL_ID=$(COGNITO_USER_POOL_ID) \
	  NEXT_PUBLIC_COGNITO_CLIENT_ID=$(COGNITO_CLIENT_ID) \
	  NEXT_PUBLIC_COGNITO_DOMAIN=$(COGNITO_DOMAIN) \
	  NEXT_PUBLIC_SITE_URL=$(WEBSITE_URL) \
	  npm run build

.PHONY: deploy-frontend
deploy-frontend: build-frontend ## Build and deploy frontend to S3 + CloudFront invalidation
	$(eval BUCKET := $(shell cd terraform && AWS_PROFILE=$(AWS_PROFILE) terraform output -raw frontend_bucket_name))
	$(eval CF_DIST := $(shell cd terraform && AWS_PROFILE=$(AWS_PROFILE) terraform output -raw cloudfront_distribution_id))
	aws s3 sync apps/web/out/ s3://$(BUCKET) --delete --profile $(AWS_PROFILE)
	aws cloudfront create-invalidation --distribution-id $(CF_DIST) --paths "/*" --profile $(AWS_PROFILE)
	@echo "Frontend deployed to $(BUCKET) (CloudFront invalidation in progress)"

.PHONY: deploy
deploy: ## Full deploy: API + migrations + frontend + integration tests
	@$(MAKE) --no-print-directory deploy-api ENV=$(ENV)
	@$(MAKE) --no-print-directory db-migrate-dev ENV=$(ENV)
	@$(MAKE) --no-print-directory deploy-frontend ENV=$(ENV)
	@$(MAKE) --no-print-directory test-integration ENV=$(ENV)
	@echo "Full deployment and verification complete!"

.PHONY: put-google-oauth
put-google-oauth: ## Store Google OAuth client id/secret in SSM (GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...)
	@if [ -z "$(GOOGLE_CLIENT_ID)" ] || [ -z "$(GOOGLE_CLIENT_SECRET)" ]; then \
		echo "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required"; \
		exit 1; \
	fi
	aws ssm put-parameter --name "/skill-book/$(ENV)/google-oauth-client-id" \
		--type SecureString --value "$(GOOGLE_CLIENT_ID)" --overwrite \
		--region $(AWS_REGION) --profile $(AWS_PROFILE)
	aws ssm put-parameter --name "/skill-book/$(ENV)/google-oauth-client-secret" \
		--type SecureString --value "$(GOOGLE_CLIENT_SECRET)" --overwrite \
		--region $(AWS_REGION) --profile $(AWS_PROFILE)
	@echo "Stored Google OAuth parameters for $(ENV)"

.PHONY: verify-cli-package
verify-cli-package: tf-switch ## Build, pack, and smoke-test the publishable CLI tarball in a clean Docker container (ENV=dev)
ifeq ($(ENV),prd)
	@echo "verify-cli-package runs against the dev API only"; exit 1
else
	$(eval API_URL := $(shell cd terraform && AWS_PROFILE=$(AWS_PROFILE) terraform output -raw api_url))
	$(eval BYPASS_TOKEN := $(shell cd terraform && AWS_PROFILE=$(AWS_PROFILE) terraform output -raw integration_test_bypass_token))
	API_URL=$(API_URL) BYPASS_TOKEN=$(BYPASS_TOKEN) ./scripts/verify_cli_package.sh
endif

.PHONY: publish-cli
publish-cli: ## Publish @skill-book/cli to the public npm registry (run verify-cli-package first; needs npm login + 2FA)
	@echo "About to publish @skill-book/cli to the public npm registry — this is irreversible."
	@echo "Confirm 'make verify-cli-package ENV=dev' passed and 'npm whoami' shows the intended account."
	cd packages/cli && npm publish

.PHONY: create-e2e-user
create-e2e-user: tf-switch ## Create/reset the E2E password test user in Cognito (E2E_USER_EMAIL=... E2E_USER_PASSWORD=...)
	@if [ -z "$(E2E_USER_EMAIL)" ] || [ -z "$(E2E_USER_PASSWORD)" ]; then \
		echo "E2E_USER_EMAIL and E2E_USER_PASSWORD are required"; \
		exit 1; \
	fi
	$(eval POOL_ID := $(shell cd terraform && AWS_PROFILE=$(AWS_PROFILE) terraform output -raw cognito_user_pool_id))
	-aws cognito-idp admin-create-user --user-pool-id $(POOL_ID) \
		--username "$(E2E_USER_EMAIL)" \
		--user-attributes Name=email,Value="$(E2E_USER_EMAIL)" Name=email_verified,Value=true \
		--message-action SUPPRESS --profile $(AWS_PROFILE) 2>/dev/null
	aws cognito-idp admin-set-user-password --user-pool-id $(POOL_ID) \
		--username "$(E2E_USER_EMAIL)" --password "$(E2E_USER_PASSWORD)" \
		--permanent --profile $(AWS_PROFILE)
	@echo "E2E user ready: $(E2E_USER_EMAIL)"

# =============================================================================
# Terraform
# =============================================================================

TF_SENTINEL := terraform/.terraform/.initialized_env

.PHONY: tf-bootstrap
tf-bootstrap: ## Create the Terraform state bucket and lock table (one-time per account)
	./scripts/bootstrap_tf_state.sh $(ENV) $(AWS_REGION)

.PHONY: tf-switch
tf-switch: ## Initialize backend and switch workspace based on ENV (dev/prd); skips re-init if already done
	@CURRENT=$$(cat $(TF_SENTINEL) 2>/dev/null || echo ""); \
	if [ "$$CURRENT" != "$(ENV)" ]; then \
		echo "Switching to $(ENV) environment (re-initializing Terraform backend)..."; \
		cd terraform && \
		export AWS_PROFILE=$(AWS_PROFILE) && \
		rm -f .terraform/environment && \
		terraform init -reconfigure -backend-config=backends/$(ENV).hcl && \
		(terraform workspace select $(ENV) || terraform workspace new $(ENV)) && \
		echo "$(ENV)" > .terraform/.initialized_env; \
	else \
		echo "Already initialized for $(ENV) environment, selecting workspace..."; \
		cd terraform && export AWS_PROFILE=$(AWS_PROFILE) && \
		(terraform workspace select $(ENV) || terraform workspace new $(ENV)); \
	fi

.PHONY: tf-init
tf-init: tf-switch ## Initialize Terraform for the current environment

.PHONY: tf-plan
tf-plan: tf-switch ## Run Terraform plan and validate with conftest policies
	cd terraform && AWS_PROFILE=$(AWS_PROFILE) terraform plan -out=tfplan.tfplan
	cd terraform && AWS_PROFILE=$(AWS_PROFILE) terraform show -json tfplan.tfplan > tfplan.json
	$(CONFTEST) test terraform/tfplan.json --policy terraform/policies/

.PHONY: tf-policy
tf-policy: ## Run conftest policy checks on an existing plan (run tf-plan first)
	$(CONFTEST) test terraform/tfplan.json --policy terraform/policies/

.PHONY: conftest-verify
conftest-verify: ## Check OPA policy syntax — fast, no AWS credentials needed
	$(CONFTEST) verify --policy terraform/policies/

.PHONY: conftest-test-fixtures
conftest-test-fixtures: conftest-verify ## Verify policy behaviour: valid plan passes, violation plan fails
	$(CONFTEST) test terraform/policies/testdata/valid_plan.json --policy terraform/policies/
	@$(CONFTEST) test terraform/policies/testdata/violation_plan.json --policy terraform/policies/; \
		rc=$$?; \
		test $$rc -ne 0 || (echo "FAIL: violation_plan.json passed — policy regression detected" >&2; exit 1)

.PHONY: tf-apply
tf-apply: tf-switch ## Run Terraform apply
	cd terraform && AWS_PROFILE=$(AWS_PROFILE) terraform apply -auto-approve

.PHONY: tf-output
tf-output: tf-switch ## Show Terraform outputs
	cd terraform && AWS_PROFILE=$(AWS_PROFILE) terraform output

.PHONY: tf-fmt
tf-fmt: ## Format Terraform configuration
	cd terraform && terraform fmt -recursive

.PHONY: tf-validate
tf-validate: ## Validate Terraform configuration
	cd terraform && terraform validate

# =============================================================================
# Testing
# =============================================================================

.PHONY: test
test: test-unit lint ## Run the default fast suite: unit tests + lint

.PHONY: test-unit
test-unit: ## Run all unit tests across workspaces (shared/cli/web; api needs docker db -> test-api)
	npm run test --workspace packages/shared --workspace packages/cli --workspace apps/web --if-present

.PHONY: test-api
test-api: db-up ## Run API handler tests against local docker Postgres
	cd apps/api && DATABASE_URL=$(LOCAL_DATABASE_URL) npm run test

.PHONY: test-integration
test-integration: tf-switch ## Run integration tests against the deployed environment selected by ENV
ifeq ($(ENV),prd)
	@echo "Skipping integration tests in prd (bypass auth not available)"
else
	$(eval API_URL := $(shell cd terraform && AWS_PROFILE=$(AWS_PROFILE) terraform output -raw api_url))
	$(eval BYPASS_TOKEN := $(shell cd terraform && AWS_PROFILE=$(AWS_PROFILE) terraform output -raw integration_test_bypass_token))
	$(eval BYPASS_TOKEN_2 := $(shell cd terraform && AWS_PROFILE=$(AWS_PROFILE) terraform output -raw integration_test_bypass_token_2))
	cd apps/api && API_URL=$(API_URL) \
		INTEGRATION_TEST_BYPASS_TOKEN=$(BYPASS_TOKEN) \
		INTEGRATION_TEST_BYPASS_TOKEN_2=$(BYPASS_TOKEN_2) \
		npm run test:integration
endif

.PHONY: test-e2e-local
test-e2e-local: ## Run Playwright Chromium against the local bypass stack (requires `make dev-api` running)
	cd apps/web && E2E_TARGET=local npx playwright test --project=chromium $(TEST_ARGS)

.PHONY: test-e2e-dev
test-e2e-dev: ## Run E2E tests against the deployed dev environment (chromium + Mobile Chrome)
	cd apps/web && E2E_TARGET=dev npx playwright test --project=chromium $(TEST_ARGS)
	cd apps/web && E2E_TARGET=dev npx playwright test --project="Mobile Chrome" $(TEST_ARGS)

.PHONY: test-all
test-all: test-unit lint test-api test-integration test-e2e-dev ## Run the full suite: unit + lint + api + integration + E2E

.PHONY: stop-hook-unit-tests
stop-hook-unit-tests: ## Run unit tests from Claude/Codex Stop hooks
	@$(MAKE) --no-print-directory test-unit

.PHONY: test-claude-hooks
test-claude-hooks: ## Verify Claude Code hook behaviour
	./scripts/test_claude_pre_tool_use_guard.sh

# =============================================================================
# Formatting & Linting
# =============================================================================

FILE_PATH ?=

.PHONY: format
format: ## Run project auto-formatters (prettier + terraform fmt)
	npm run format
	cd terraform && terraform fmt -recursive 2>/dev/null || true

.PHONY: format-check
format-check: ## Run formatter checks without modifying files
	npm run format:check
	cd terraform && terraform fmt -check -recursive 2>/dev/null || true

.PHONY: lint
lint: ## Run ESLint across all workspaces
	npm run lint

.PHONY: lint-fix
lint-fix: ## Run ESLint with auto-fixes
	npm run lint:fix

.PHONY: claude-post-tool-use
claude-post-tool-use: ## Run hook-safe format/lint steps for a single edited file (FILE_PATH=...)
	@if [ -z "$(FILE_PATH)" ]; then \
		echo "FILE_PATH is required"; \
		exit 1; \
	fi
	@file_path="$(FILE_PATH)"; \
	case "$$file_path" in \
		*.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) \
			npx prettier --write "$$file_path" >/dev/null 2>&1 || true; \
			npx eslint --fix "$$file_path" || true ;; \
		terraform/*.tf|terraform/*.tfvars) \
			cd terraform && terraform fmt "$${file_path#terraform/}" ;; \
		terraform/policies/*.rego|terraform/policies/**/*.rego) \
			$(MAKE) --no-print-directory conftest-verify ;; \
		*) \
			true ;; \
	esac

.PHONY: claude-pre-tool-use
claude-pre-tool-use: ## Block destructive Claude Bash commands based on CLAUDE_HOOK_COMMAND
	@node scripts/claude_pre_tool_use_guard.mjs

.PHONY: install-hooks
install-hooks: ## Install git hooks via lefthook
	mise exec -- lefthook install
	@echo "Git hooks installed via lefthook."

# =============================================================================
# Utilities
# =============================================================================

.PHONY: logs
logs: ## Tail Lambda logs
	aws logs tail /aws/lambda/skill-book-api-$(ENV) --follow --profile $(AWS_PROFILE)

.PHONY: clean
clean: ## Clean build artifacts
	rm -rf apps/web/out apps/web/.next apps/api/dist packages/shared/dist packages/cli/dist
	rm -f $(TF_SENTINEL)
