import { Command } from "commander";
import { artifactTypeLabel, type ArtifactType, type ScanFinding } from "@skill-book/shared";
import { scanFiles, isProbablyBinary } from "@skill-book/shared/scanner";
import { createZip, safeUnzip } from "@skill-book/shared/zip";
import { api, ApiError, printFindings } from "./api.js";
import { clearCredentials, loginWithBrowser, loginWithPassword } from "./auth.js";
import { readStoredCredentials } from "./config.js";
import { collectContent, slugify } from "./content.js";
import { executeInstall, planInstall } from "./install.js";

const program = new Command();
const decoder = new TextDecoder();

program
  .name("skill-book")
  .description("Internal registry for Claude Skills, CLAUDE.md, and AGENTS.md files")
  .version("0.1.0");

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
  .action(async () => {
    const stored = readStoredCredentials();
    if (process.env.SKILL_BOOK_BYPASS_TOKEN) {
      const me = await api.me();
      console.log(`${me.email} (bypass token)`);
      return;
    }
    if (!stored?.email) {
      fail("not logged in — run `skill-book login`");
    }
    const me = await api.me();
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

    console.log(`Pushing ${name} (${artifactTypeLabel(type)}, ${content.entries.length} files)…`);

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
    const upload = await api.requestUpload();
    const putRes = await fetch(upload.url, {
      method: "PUT",
      headers: { "Content-Type": "application/zip" },
      body: zip.buffer as ArrayBuffer,
    });
    if (!putRes.ok) fail(`staging upload failed (${putRes.status})`);

    try {
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
  .description("Download and install an artifact (name or name@version)")
  .option("--global", "install CLAUDE.md/AGENTS.md to ~/.claude/ instead of the current directory")
  .option("--dest <path>", "explicit destination directory/file")
  .option("--force", "overwrite existing files")
  .option("--dry-run", "show what would be written without writing")
  .action(async (nameSpec: string, options) => {
    const [name, versionRaw] = nameSpec.split("@");
    const version = versionRaw ? Number(versionRaw) : undefined;
    if (versionRaw && !Number.isInteger(version)) fail(`invalid version: ${versionRaw}`);

    const info = await api.downloadInfo(name!, version);
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
  .action(async (query: string | undefined, options) => {
    const params: Record<string, string> = {};
    if (query) params.q = query;
    if (options.type) params.type = options.type;
    if (options.tag) params.tag = options.tag;
    const { artifacts } = await api.list(params);
    if (artifacts.length === 0) {
      console.log("No artifacts found.");
      return;
    }
    for (const artifact of artifacts) {
      const stars = artifact.ratingAverage ? `★${artifact.ratingAverage.toFixed(1)}` : "★—";
      console.log(
        `${artifact.name.padEnd(32)} ${artifact.type.padEnd(13)} v${String(
          artifact.latestVersion ?? "—",
        ).padEnd(4)} ${stars} ⬇${artifact.downloadCount}  ${artifact.description.slice(0, 60)}`,
      );
    }
  });

program
  .command("list")
  .description("List all artifacts")
  .action(async () => {
    await program.parseAsync(["node", "skill-book", "search"]);
  });

program
  .command("info <name>")
  .description("Show artifact details")
  .action(async (name: string) => {
    const detail = await api.get(name);
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

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

program.parseAsync().catch((err) => {
  console.error(`error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
