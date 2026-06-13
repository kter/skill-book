import readline from "node:readline";
import { Command } from "commander";
import { artifactTypeLabel, type ArtifactType, type ScanFinding } from "@skill-book/shared";
import { scanFiles, isProbablyBinary } from "@skill-book/shared/scanner";
import { createZip, safeUnzip } from "@skill-book/shared/zip";
import { api, ApiError, printFindings } from "./api.js";
import { clearCredentials, loginWithBrowser, loginWithPassword } from "./auth.js";
import { loadCliConfig, readStoredCredentials } from "./config.js";
import { collectContent, slugify } from "./content.js";
import { friendlyError, parseVersionSpec, truncate } from "./format.js";
import { executeInstall, planInstall } from "./install.js";

const program = new Command();
const decoder = new TextDecoder();

program
  .name("skill-book")
  .description("Internal registry for Claude Skills, CLAUDE.md, and AGENTS.md files")
  .version("0.1.1")
  .addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  $ skill-book login",
      "  $ skill-book search terraform --type CLAUDE_SKILL",
      "  $ skill-book info some-skill",
      "  $ skill-book install some-skill",
      "  $ skill-book install team-rules --global",
      "  $ skill-book push ./my-skill --dry-run",
      "",
    ].join("\n"),
  );

program
  .command("login")
  .description("Sign in (browser-based by default; --password for non-interactive)")
  .option("--password", "use email/password instead of the browser flow")
  .option("--email <email>", "email for --password (or SKILL_BOOK_EMAIL)")
  .action(async (options: { password?: boolean; email?: string }) => {
    if (options.password) {
      const email = options.email ?? process.env.SKILL_BOOK_EMAIL;
      const password = process.env.SKILL_BOOK_PASSWORD;
      if (!email || !password) {
        fail("--password requires --email (or SKILL_BOOK_EMAIL) and SKILL_BOOK_PASSWORD");
      }
      const credentials = await loginWithPassword(email!, password!);
      console.log(`Logged in as ${credentials.email}`);
      return;
    }
    const credentials = await loginWithBrowser();
    console.log(`Logged in as ${credentials.email}`);
  });

program
  .command("logout")
  .description("Remove stored credentials")
  .action(() => {
    clearCredentials();
    console.log("Logged out.");
  });

program
  .command("whoami")
  .description("Show the signed-in user")
  .option("--json", "output as JSON")
  .action(async (options: { json?: boolean }) => {
    const stored = readStoredCredentials();
    if (process.env.SKILL_BOOK_BYPASS_TOKEN) {
      const me = await api.me();
      if (options.json) return printJson({ email: me.email, bypassToken: true });
      console.log(`${me.email} (bypass token)`);
      return;
    }
    if (!stored?.email) {
      fail("not logged in — run `skill-book login`");
    }
    const me = await api.me();
    if (options.json) return printJson({ email: me.email });
    console.log(me.email);
  });

program
  .command("push [path]")
  .description("Package and publish a skill directory, CLAUDE.md, or AGENTS.md")
  .option("--name <slug>", "artifact name (kebab-case; defaults to folder/frontmatter name)")
  .option("--type <type>", "CLAUDE_SKILL | CLAUDE_MD | AGENTS_MD (auto-detected)")
  .option("--description <text>", "description shown in the registry", "")
  .option("--tag <tag...>", "tags", [])
  .option("--message <text>", "version message")
  .option("--override <fingerprint...>", "accept these scan fingerprints as false positives", [])
  .option("--skip-local-scan", "skip the local pre-scan (the server still scans)")
  .option("--dry-run", "show what would be published without uploading anything")
  .option("--yes", "skip the confirmation prompt")
  .action(async (targetPath: string | undefined, options) => {
    const content = collectContent(targetPath ?? ".");
    const type = (options.type as ArtifactType | undefined) ?? content.detectedType;
    let name: string = options.name ?? "";
    if (!name) {
      // For skills, prefer the SKILL.md frontmatter name
      const skillMd = content.entries.find((e) => e.path === "SKILL.md");
      if (skillMd && type === "CLAUDE_SKILL") {
        const match = decoder.decode(skillMd.data).match(/^---[\s\S]*?\bname:\s*(\S+)/);
        name = match?.[1] ? slugify(match[1]) : content.suggestedName;
      } else {
        name = content.suggestedName;
      }
    }
    if (!name) fail("could not infer a name — pass --name <slug>");

    const overrides = new Set<string>(options.override as string[]);

    if (!options.skipLocalScan) {
      const textFiles = content.entries
        .filter((e) => !isProbablyBinary(e.data))
        .map((e) => ({ path: e.path, text: decoder.decode(e.data) }));
      const findings = scanFiles(textFiles).filter((f) => !overrides.has(f.fingerprint));
      if (findings.length > 0) {
        printFindings(findings);
        fail(
          "local scan found potential secrets — remove them, or re-run with " +
            findings.map((f) => `--override ${f.fingerprint}`).join(" ") +
            " if they are confirmed false positives",
        );
      }
    }

    // Preview the inferred name/type and the exact files before any network call,
    // so an accidental publish under a wrong name is caught here (versions are immutable).
    console.log("Push preview:");
    console.log(`  name:  ${name}`);
    console.log(`  type:  ${artifactTypeLabel(type)}`);
    console.log(`  files: ${content.entries.length}`);
    const preview = content.entries.slice(0, 20);
    for (const entry of preview) console.log(`    ${entry.path}`);
    if (content.entries.length > preview.length) {
      console.log(`    … and ${content.entries.length - preview.length} more`);
    }
    if (options.dryRun) {
      console.log("Dry run — nothing uploaded.");
      return;
    }
    if (process.stdin.isTTY && !options.yes) {
      const ok = await confirm(`Publish ${name}? [y/N] `);
      if (!ok) {
        console.log("Aborted.");
        return;
      }
    }

    console.log(`Pushing ${name}…`);
    try {
      await api.create({
        name,
        type,
        description: options.description,
        tags: options.tag as string[],
      });
      console.log(`Created new artifact: ${name}`);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 409)) throw err;
    }

    for (const fingerprint of overrides) {
      await api.addOverride(name, fingerprint, "accepted via skill-book push --override");
    }

    const zip = createZip(content.entries);
    console.log("Uploading…");
    const upload = await api.requestUpload();
    const putRes = await fetch(upload.url, {
      method: "PUT",
      headers: { "Content-Type": "application/zip" },
      body: zip.buffer as ArrayBuffer,
    });
    if (!putRes.ok) fail(`staging upload failed (${putRes.status})`);

    try {
      console.log("Publishing…");
      const result = await api.publish(name, upload.key, options.message);
      if (result.status === "PUBLISHED") {
        console.log(`Published ${name} v${result.version}`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const findings = (err.body.findings as ScanFinding[] | undefined) ?? [];
        if (findings.length > 0) {
          printFindings(findings);
          fail(
            "blocked by the server-side secrets scan — re-run with " +
              findings.map((f) => `--override ${f.fingerprint}`).join(" ") +
              " if these are confirmed false positives",
          );
        }
        fail(
          `validation failed: ${(err.body.details as string[] | undefined)?.join("; ") ?? err.message}`,
        );
      }
      throw err;
    }
  });

program
  .command("install <name>")
  .description("Download and install an artifact (name, name@version, or name@latest)")
  .option("--global", "install CLAUDE.md/AGENTS.md to ~/.claude/ instead of the current directory")
  .option("--dest <path>", "explicit destination directory/file")
  .option("--force", "overwrite existing files")
  .option("--dry-run", "show what would be written without writing")
  .action(async (nameSpec: string, options) => {
    const { name, version } = parseVersionSpec(nameSpec);
    const info = await api.downloadInfo(name, version);
    console.log(`Downloading ${info.name} v${info.version}…`);
    const zipRes = await fetch(info.url);
    if (!zipRes.ok) fail(`download failed (${zipRes.status})`);
    const zip = new Uint8Array(await zipRes.arrayBuffer());
    const entries = safeUnzip(zip);

    const plan = planInstall(info.type as ArtifactType, info.name, entries, {
      global: options.global,
      dest: options.dest,
    });

    console.log(`Installing ${info.name} v${info.version} → ${plan.baseDir}`);
    for (const file of plan.files) {
      const conflict = plan.conflicts.includes(file.target) ? " (exists)" : "";
      console.log(`  ${file.target}${conflict}`);
    }
    if (options.dryRun) {
      console.log("Dry run — nothing written.");
      return;
    }
    const written = executeInstall(plan, { force: options.force, dryRun: false });
    console.log(`Installed ${written.length} file(s).`);
  });

program
  .command("search [query]")
  .description("Search the registry")
  .option("--type <type>", "filter by type")
  .option("--tag <tag>", "filter by tag")
  .option("--json", "output as JSON")
  .action((query: string | undefined, options) => runSearch(query, options));

program
  .command("list")
  .description("List all artifacts")
  .option("--type <type>", "filter by type")
  .option("--tag <tag>", "filter by tag")
  .option("--json", "output as JSON")
  .action((options) => runSearch(undefined, options));

program
  .command("info <name>")
  .description("Show artifact details")
  .option("--json", "output as JSON")
  .action(async (name: string, options: { json?: boolean }) => {
    const detail = await api.get(name);
    if (options.json) return printJson(detail);
    console.log(`${detail.name} (${artifactTypeLabel(detail.type)})`);
    console.log(`  ${detail.description}`);
    console.log(`  owner:     ${detail.ownerDisplayName ?? "unknown"}`);
    console.log(`  tags:      ${detail.tags.join(", ") || "—"}`);
    console.log(`  rating:    ${detail.ratingAverage?.toFixed(1) ?? "—"} (${detail.ratingCount})`);
    console.log(`  downloads: ${detail.downloadCount}`);
    console.log(`  latest:    v${detail.latestVersion ?? "—"}`);
    if (detail.forkedFromName) console.log(`  fork of:   ${detail.forkedFromName}`);
    console.log(`  install:   npx @skill-book/cli install ${detail.name}`);
  });

async function runSearch(
  query: string | undefined,
  options: { type?: string; tag?: string; json?: boolean },
): Promise<void> {
  const params: Record<string, string> = {};
  if (query) params.q = query;
  if (options.type) params.type = options.type;
  if (options.tag) params.tag = options.tag;
  const { artifacts } = await api.list(params);
  if (options.json) return printJson(artifacts);
  if (artifacts.length === 0) {
    console.log("No artifacts found.");
    return;
  }
  console.log(
    `${"NAME".padEnd(32)} ${"TYPE".padEnd(13)} ${"VER".padEnd(5)} ${"RATING".padEnd(6)} ${"DL".padEnd(5)} DESCRIPTION`,
  );
  for (const artifact of artifacts) {
    const stars = artifact.ratingAverage ? `★${artifact.ratingAverage.toFixed(1)}` : "★—";
    const ver = `v${artifact.latestVersion ?? "—"}`;
    console.log(
      `${truncate(artifact.name, 32).padEnd(32)} ${artifact.type.padEnd(13)} ${ver.padEnd(5)} ${stars.padEnd(6)} ⬇${String(artifact.downloadCount).padEnd(3)} ${truncate(artifact.description, 60)}`,
    );
  }
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

program.parseAsync().catch((err) => {
  console.error(`error: ${friendlyError(err, loadCliConfig().apiUrl)}`);
  process.exit(1);
});
