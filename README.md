# skill-book

社内の Claude Skills / CLAUDE.md / AGENTS.md を共有するレジストリ。
アップロード時の機密スキャン（検出時ブロック + fingerprint オーバーライド）、所有者のみ更新の不変バージョン履歴、フォーク系譜、星評価、ダウンロード集計を備える。

- Web: https://skill-book.dev.devtools.site (dev)
- API: https://api.skill-book.dev.devtools.site (dev)

利用者向けの使い方は **[利用マニュアル（docs/MANUAL.md）](docs/MANUAL.md)** を参照。

## Stack

TypeScript monorepo (npm workspaces):

| Path | What |
|---|---|
| `apps/api` | Hono on Lambda (API Gateway HTTP API) + Aurora DSQL |
| `apps/web` | Next.js static export → S3 + CloudFront |
| `packages/shared` | secrets scanner / zip safety / validators (API・CLI で共用) |
| `packages/cli` | `skill-book` CLI (push / install / search) |
| `terraform/` | インフラ一式（S3 リモートステート、workspace = dev/prd） |

ツールは `mise.toml` で固定。`direnv allow` + `mise install` で揃う。

## Local development

```bash
make install          # npm deps
make install-hooks    # lefthook git hooks
make dev-stack        # Postgres(:5433, docker) + API(:8000) + Web(:3000, auth bypass)
```

ローカルは `ENVIRONMENT=local`: 認証は bypass（X-Dev-User）、S3 はファイルシステム代替。
DB は `DSQL_CLUSTER_ENDPOINT` が空なら `DATABASE_URL`（docker Postgres）を使う。

## Testing

```bash
make test             # unit + lint（高速・pre-commit 相当）
make test-api         # API ハンドラテスト（docker Postgres 必須）
make test-e2e-local   # Playwright（`make dev-api` を別ターミナルで起動しておく）
make test-integration ENV=dev   # デプロイ済み dev への結合テスト
make test-e2e-dev     # デプロイ済み dev への E2E（要 E2E_TEST_USER_EMAIL/PASSWORD）
```

## First-time setup (dev)

1. `make tf-bootstrap ENV=dev` — ステートバケット + ロックテーブル作成（冪等）
2. `make tf-plan ENV=dev` — conftest ポリシーチェック込み
3. `make build-api && make tf-apply ENV=dev`
4. `make db-migrate-dev ENV=dev` — DSQL へマイグレーション適用
5. `make deploy-frontend ENV=dev`
6. E2E ユーザー作成: `make create-e2e-user ENV=dev E2E_USER_EMAIL=... E2E_USER_PASSWORD=...`

### Google ログインの有効化（任意・人手作業あり）

1. GCP コンソールで OAuth クライアント（Web application）を作成。
   redirect URI: `https://skill-book-dev.auth.ap-northeast-1.amazoncognito.com/oauth2/idpresponse`
2. `make put-google-oauth ENV=dev GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...`
3. `cd terraform && terraform apply -var enable_google_idp=true`（以後の apply にも同 var を付ける）

Email/Password ログインは Google なしで常に使える。

## CLI

```bash
npx @skill-book/cli login                 # ブラウザで PKCE ログイン
skill-book push ./my-skill                # 事前スキャン → アップロード → 公開
skill-book install some-skill             # ~/.claude/skills/some-skill/ へ展開
skill-book install team-rules --global    # CLAUDE.md を ~/.claude/ へ
skill-book search terraform
```

API URL は `SKILL_BOOK_API_URL` で上書き可（デフォルト: dev 環境）。

### 配布（公開 npm）

CLI 本体は秘密を持たない汎用クライアントで、**取得は誰でも可・操作はすべて API 側の
認証認可で守られる**（無資格 / 無効トークンは 401）。そのため公開 npm に置き、
`npx @skill-book/cli` をそのまま使えるようにする。スコープを自前で押さえることで
dependency confusion も防ぐ。

公開は取り消せないため、**publish 前に必ず Docker 隔離で実 tarball を検証する**:

```bash
make verify-cli-package ENV=dev   # 実publishされるtarballをcleanなcontainerでsmoke
                                  #   - npm i -g で外部依存ゼロ（バンドル自己完結）を確認
                                  #   - 無効トークン→401 / 無資格→拒否（認証認可の境界）
                                  #   - whoami / search / install（dry-run→実書込→上書き拒否）
                                  #   - 配置先はコンテナ内のみ。ホストの ~/.claude は不可侵
make publish-cli                  # npm login + 2FA 済みアカウントで公開（最後の手動ステップ）
```

> パッケージは現状 dev エンドポイントを既定に同梱する。別レジストリ（会社 prd 等）へ
> 向けるときは `SKILL_BOOK_API_URL` を設定し、同梱の既定値に依存しないこと。

## prd について

prd は会社アカウントへデプロイ予定。`terraform/backends/prd.hcl` は定義のみで、
この（私用）マシンから `ENV=prd` での apply は行わないこと。
