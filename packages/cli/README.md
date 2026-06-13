# @skill-book/cli

Command-line client for **skill-book**, the internal registry for Claude Skills,
`CLAUDE.md`, and `AGENTS.md` files.

The package is published publicly so it can be fetched with a single command, but
**every operation is gated behind authentication and authorization at the API**.
Downloading the CLI grants nothing on its own — `push`, `install`, `search`, and
the rest only work once you have signed in, and you only ever see what your
account is permitted to see.

## Install

```bash
npm install -g @skill-book/cli
# or run ad hoc without installing:
npx @skill-book/cli <command>
```

## Sign in

```bash
skill-book login            # browser-based sign-in (Google SSO / email + password)
skill-book login --password # non-interactive (SKILL_BOOK_EMAIL + SKILL_BOOK_PASSWORD)
skill-book whoami
```

## Common commands

```bash
skill-book search [query] [--type CLAUDE_SKILL|CLAUDE_MD|AGENTS_MD] [--tag <tag>] [--json]
skill-book info <name> [--json]
skill-book install <name>[@version|@latest] [--global] [--dest <path>] [--force] [--dry-run]
skill-book push [path] [--name <slug>] [--type <type>] [--tag <tag>...] [--dry-run] [--yes]
```

`search`, `list`, `info`, and `whoami` accept `--json` for scripting.

`push --dry-run` prints the inferred name/type and the exact file list **without
uploading anything** — use it to confirm a publish before it happens (versions are
immutable). On a TTY, `push` also asks for confirmation unless you pass `--yes`.

A Claude Skill is a directory containing a `SKILL.md` at its root. The minimal form:

```markdown
---
name: my-skill
description: One line describing what the skill does.
---

# My Skill

Instructions for the skill go here.
```

`install` writes only to the explicit target (a Claude Skill goes to
`~/.claude/skills/<name>/`, a `CLAUDE.md`/`AGENTS.md` to the current directory or,
with `--global`, to `~/.claude/`). It refuses to overwrite existing files unless
you pass `--force`, and `--dry-run` shows the plan without touching disk.

## Configuration

| Variable | Purpose |
| --- | --- |
| `SKILL_BOOK_API_URL` | Registry API base URL. Overrides the built-in default. |
| `SKILL_BOOK_BYPASS_TOKEN` | Pre-issued bearer token (CI / automated checks). |
| `SKILL_BOOK_EMAIL` / `SKILL_BOOK_PASSWORD` | Credentials for `login --password`. |

> **Pointing the CLI at your own deployment.** The published build ships with the
> shared dev endpoint as its default. For a separate (e.g. company production)
> registry, set `SKILL_BOOK_API_URL` — do not rely on the baked-in default. A
> future release may drop the hard-coded URL entirely in favour of explicit
> configuration so the public package never carries an internal endpoint.
