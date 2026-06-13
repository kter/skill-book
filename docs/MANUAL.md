# skill-book 利用マニュアル

社内向けのスキルレジストリ **skill-book** の使い方をまとめたものです。
各自が持つ Claude の知見（Claude Skill / `CLAUDE.md` / `AGENTS.md`）を登録し、
他のメンバーが検索・取得・評価・更新できるようにすることで、AI ハーネスの
ノウハウを組織で共有します。

- **Web**: <https://skill-book.dev.devtools.site>
- **API**: <https://api.skill-book.dev.devtools.site>

> **基本原則**
> 1. **あなたのローカルファイルは、明示的な `install`（または Web からの zip 展開）以外で一切変更されません。**
> 2. **取得は誰でも可能ですが、あらゆる操作は認証認可で保護されています。** 未ログイン・無効トークンは拒否（401）され、見えるのは権限のある範囲だけです。
> 3. **機密情報はアップロード時に自動検知してブロックします。** 検知された値はマスクして保存し、平文は保持しません。

---

## 1. 取り扱うもの（3つの型）

| 型 | 中身 | 既定のインストール先 |
| --- | --- | --- |
| `CLAUDE_SKILL` | `SKILL.md` と付属ファイルを含むディレクトリ | `~/.claude/skills/<name>/` |
| `CLAUDE_MD` | 単一の `CLAUDE.md` | カレントの `./CLAUDE.md`（`--global` で `~/.claude/CLAUDE.md`） |
| `AGENTS_MD` | 単一の `AGENTS.md` | カレントの `./AGENTS.md`（`--global` で `~/.claude/AGENTS.md`） |

型はアップロード時に内容から自動判定されます（`--type` で明示も可能）。

---

## 2. アクセスと認証

skill-book は社内メンバー専用です。認証は Cognito（Google SSO / email + password）で行います。

- **Web**: ブラウザでサイトを開き、サインインします。
- **CLI**: 次章の `skill-book login` でサインインします。

CLI が認証情報を保存するのは **`~/.config/skill-book/credentials.json`**（Windows は
`%APPDATA%\skill-book\`、パーミッション `0600`）だけです。`~/.claude` には触れません。

---

## 3. Web の使い方

### 閲覧・検索
トップページで一覧・検索ができます。

- **検索ボックス**: 名前・説明・タグ・公開済み本文を横断検索
- **フィルタ**: 型（Claude Skill / CLAUDE.md / AGENTS.md）、タグ
- **並び替え**: 更新が新しい順 / ダウンロード数 / 評価

### 詳細ページ
アーティファクトを開くと、説明・タグ・所有者・評価・ダウンロード数・本文プレビュー・
バージョン履歴が見られます。ここから次が可能です。

- **zip ダウンロード**: 中身をまとめて取得（手動展開）
- **CLI ワンライナー表示**: `npx @skill-book/cli install <name>`（CLI 公開後に有効）
- **評価**: 星 1〜5 を付与（1 人 1 票、付け直し可）

### アップロード
アップロードページで、フォルダ / ファイルをドラッグ＆ドロップ、または選択します。

1. 型が自動判定されます。
2. **機密スキャン**が走り、検知があると公開がブロックされます（該当値はマスク表示）。
3. 誤検知であれば、所有者が指紋（fingerprint）単位で**オーバーライド**して再試行できます。

### フォーク
他人のアーティファクトを派生させたい場合はフォークします。派生元との系譜が記録されます。

---

## 4. CLI の使い方

### 4.1 インストール

CLI 公開後（npm 公開後）は次で導入できます。

```bash
npm install -g @skill-book/cli      # グローバル導入
# もしくは都度実行：
npx @skill-book/cli <command>
```

### 4.2 認証（3経路）

**① ブラウザ PKCE ログイン（既定・人間向け）**
```bash
skill-book login
```
Cognito Hosted UI が開き、Google SSO か email/password で認証します。ループバック
`http://localhost:8765/callback` でコードを受け取ります（ポートが塞がっていれば、
リダイレクト URL を貼り付ける方式に自動で切り替わります）。

**② パスワードログイン（非対話・CI/スクリプト向け）**
```bash
SKILL_BOOK_EMAIL=you@example.com SKILL_BOOK_PASSWORD=… skill-book login --password
# または： skill-book login --password --email you@example.com   （パスワードは環境変数）
```
パスワードが設定された Cognito ユーザーが必要です。

**③ bypass token（自動検証・dev 限定）**
```bash
SKILL_BOOK_BYPASS_TOKEN=<token> skill-book whoami
```
事前発行したベアラーを直接使います。正規ログインではなくテスト用途専用です。

```bash
skill-book whoami     # ログイン中のユーザーを表示
skill-book logout     # 保存した認証情報を削除
```

### 4.3 検索・参照

```bash
skill-book search [query] [--type CLAUDE_SKILL|CLAUDE_MD|AGENTS_MD] [--tag <tag>]
skill-book list                    # 全件
skill-book info <name>             # 詳細（説明・所有者・評価・DL数・最新版など）
```

### 4.4 インストール（取得）

```bash
skill-book install <name>[@version] [options]
```

| オプション | 意味 |
| --- | --- |
| `<name>@<version>` | バージョン指定（省略時は最新の公開版） |
| `--global` | `CLAUDE.md` / `AGENTS.md` を `~/.claude/` に置く（既定はカレント） |
| `--dest <path>` | 配置先を明示指定 |
| `--force` | 既存ファイルを上書き（**指定がなければ上書きせず中止**） |
| `--dry-run` | 何が書き込まれるか表示するだけ（ディスクには触れない） |

例：
```bash
skill-book install some-skill                # ~/.claude/skills/some-skill/ へ展開
skill-book install team-rules --global       # CLAUDE.md を ~/.claude/ へ
skill-book install team-rules --dry-run      # 書き込み内容の事前確認
skill-book install some-skill --dest ./tmp   # 試し置き
```

> **安全設計**: 書き込み先は解決済みのインストール対象の内側に限定され（パストラバーサル拒否）、
> 既存ファイルは `--force` なしには上書きされません。`--dry-run` は一切書き込みません。

### 4.5 アップロード（公開）

```bash
skill-book push [path] [options]
```

`path`（省略時はカレント）の内容を、型自動判定 →**ローカル事前スキャン**→
アップロード→公開、の順に処理します。

| オプション | 意味 |
| --- | --- |
| `--name <slug>` | 名前（kebab-case。省略時はフォルダ名 / frontmatter から推定） |
| `--type <type>` | 型を明示（既定は自動判定） |
| `--description <text>` | レジストリに表示する説明 |
| `--tag <tag...>` | タグ（複数可） |
| `--message <text>` | バージョンメッセージ |
| `--override <fingerprint...>` | 確定した誤検知の指紋を許可 |
| `--skip-local-scan` | ローカル事前スキャンを省略（**サーバ側スキャンは必ず実行**） |

機密が検知されると公開はブロックされ（HTTP 422）、検知一覧と
`--override <fingerprint>` の案内が表示されます。誤検知と確認できた場合のみ
オーバーライドして再実行してください。

### 4.6 設定（環境変数）

| 変数 | 用途 |
| --- | --- |
| `SKILL_BOOK_API_URL` | レジストリ API の URL を上書き（既定は dev 環境） |
| `SKILL_BOOK_BYPASS_TOKEN` | 事前発行ベアラー（CI / 自動検証） |
| `SKILL_BOOK_EMAIL` / `SKILL_BOOK_PASSWORD` | `login --password` 用の資格情報 |

---

## 5. バージョン・所有権・評価

- **所有者のみ更新可**: アーティファクトの更新（新バージョン公開・説明やタグの変更・
  オーバーライド）は所有者だけが行えます（他者は 403）。
- **不変のバージョン履歴**: 公開済みバージョンは差し替えられません。更新は新バージョンとして積まれます。
- **フォークと系譜**: 派生は新規アーティファクトとして作成され、派生元が記録されます。
- **評価**: 星 1〜5。1 ユーザー 1 票で付け直し可能。
- **ダウンロード数**: `install` / zip ダウンロードのたびに計上されます。

---

## 6. 機密スキャンについて

アップロードされた全テキストを、gitleaks 相当のルール群（AWS / GitHub / Slack /
OpenAI / Anthropic などのキー、秘密鍵ブロック、キーワード＋エントロピー）で検査します。

- 検知があると公開は**ブロック**されます。
- 保存されるのは**マスク済みの値のみ**（例: `AKIA************MPLE`）。平文は保持しません。
- 誤検知は**指紋単位**でオーバーライドできます（所有者のみ、理由付き）。
- 同じ検査ロジックを CLI のローカル事前スキャンとサーバ側で共有しています。

---

## 7. トラブルシュート

| 症状 | 対処 |
| --- | --- |
| `not logged in` | `skill-book login` でサインイン。 |
| 401 / `invalid token` | トークン期限切れ。再度 `skill-book login`。 |
| ポート 8765 が使用中 | ログインが URL 貼り付け方式に自動フォールバック。表示に従って貼り付け。 |
| `refusing to overwrite existing files` | 既存ファイルあり。`--force` で上書き、または `--dest` で別の場所へ。 |
| 公開が 422 でブロック | 機密検知。値を除去するか、誤検知なら `--override <fingerprint>`。 |
| Google ログインが選べない | dev では Google IdP の有効化が前提。email/password でログイン。 |
| 別の環境につなぎたい | `SKILL_BOOK_API_URL` を設定（既定値に依存しない）。 |

---

## 8. 安全性のまとめ

- ローカルファイルを変更するのは、明示的な `install`（または Web の zip 展開）だけ。
- `install` は対象ディレクトリの内側にしか書き込まず、`--force` なしに上書きしません。
- 認証情報は `~/.config/skill-book/` にのみ保存し、`~/.claude` には触れません。
- 機密はアップロード時にブロックし、マスクのみ保存。
- 取得は誰でも可能でも、操作はすべて API 側の認証認可で守られます。
