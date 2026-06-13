import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import {
  createArtifactSchema,
  listArtifactsQuerySchema,
  publishVersionSchema,
  ratingSchema,
  scanOverrideSchema,
  updateArtifactSchema,
  type ArtifactDetail,
  type ArtifactVersionSummary,
  type VersionStatus,
} from "@skill-book/shared";
import type { ApiConfig } from "../config.js";
import type { Db } from "../db/client.js";
import {
  artifacts,
  artifactTags,
  artifactVersions,
  downloadEvents,
  ratings,
  scanFindings,
  scanOverrides,
} from "../db/schema.js";
import type { Storage } from "../storage/index.js";
import {
  findArtifactByName,
  listArtifactRows,
  loadAggregates,
  toSummary,
} from "../services/artifactQueries.js";
import { getPublishedVersion, PublishError, publishVersion } from "../services/publish.js";

interface Deps {
  db: Db;
  storage: Storage;
  config: ApiConfig;
}

function versionSummary(row: typeof artifactVersions.$inferSelect): ArtifactVersionSummary {
  return {
    id: row.id,
    artifactId: row.artifactId,
    version: row.version,
    status: row.status as VersionStatus,
    totalSizeBytes: row.totalSizeBytes,
    fileCount: row.fileCount,
    message: row.message,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

export function createArtifactsRouter({ db, storage, config }: Deps): Hono {
  const app = new Hono();

  // ---- list / search ----
  app.get("/", async (c) => {
    const parsed = listArtifactsQuerySchema.safeParse({
      q: c.req.query("q") || undefined,
      tag: c.req.query("tag") || undefined,
      type: c.req.query("type") || undefined,
      sort: c.req.query("sort") || undefined,
    });
    if (!parsed.success) {
      return c.json({ error: "invalid query", details: parsed.error.flatten() }, 400);
    }
    const { q, tag, type, sort } = parsed.data;

    let rows = await listArtifactRows(db);
    if (type) rows = rows.filter((r) => r.type === type);

    const aggregates = await loadAggregates(db, rows);
    let summaries = rows.map((r) => toSummary(r, aggregates));

    if (tag) summaries = summaries.filter((s) => s.tags.includes(tag));
    if (q) {
      const needle = q.toLowerCase();
      // Search published content too — small registry, in-memory filter is fine.
      const contentMatchIds = new Set<string>();
      const versionRows = await db
        .select({
          artifactId: artifactVersions.artifactId,
          contentText: artifactVersions.contentText,
        })
        .from(artifactVersions)
        .where(eq(artifactVersions.status, "PUBLISHED"));
      for (const row of versionRows) {
        if (row.contentText?.toLowerCase().includes(needle)) contentMatchIds.add(row.artifactId);
      }
      summaries = summaries.filter(
        (s) =>
          s.name.toLowerCase().includes(needle) ||
          s.description.toLowerCase().includes(needle) ||
          s.tags.some((t) => t.toLowerCase().includes(needle)) ||
          contentMatchIds.has(s.id),
      );
    }

    if (sort === "downloads") {
      summaries.sort((a, b) => b.downloadCount - a.downloadCount);
    } else if (sort === "stars") {
      summaries.sort((a, b) => (b.ratingAverage ?? 0) - (a.ratingAverage ?? 0));
    }
    return c.json({ artifacts: summaries });
  });

  // ---- create ----
  app.post("/", async (c) => {
    const body = createArtifactSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return c.json({ error: "invalid request", details: body.error.flatten() }, 400);
    }
    const user = c.get("user");
    const { name, type, description, tags, forkedFromArtifactId } = body.data;

    if (await findArtifactByName(db, name)) {
      return c.json({ error: `artifact name already exists: ${name}` }, 409);
    }
    if (forkedFromArtifactId) {
      const source = await db
        .select({ id: artifacts.id })
        .from(artifacts)
        .where(eq(artifacts.id, forkedFromArtifactId))
        .limit(1);
      if (!source[0]) {
        return c.json({ error: "forkedFromArtifactId does not exist" }, 400);
      }
    }

    const id = randomUUID();
    await db.insert(artifacts).values({
      id,
      name,
      type,
      description,
      ownerUserId: user.id,
      forkedFromArtifactId: forkedFromArtifactId ?? null,
    });
    for (const tag of new Set(tags)) {
      await db.insert(artifactTags).values({ artifactId: id, tag });
    }
    return c.json({ id, name }, 201);
  });

  // ---- detail ----
  app.get("/:name", async (c) => {
    const artifact = await findArtifactByName(db, c.req.param("name"));
    if (!artifact) return c.json({ error: "not found" }, 404);
    const user = c.get("user");

    const aggregates = await loadAggregates(db, [artifact]);
    const summary = toSummary(artifact, aggregates);

    const versionRows = await db
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, artifact.id))
      .orderBy(desc(artifactVersions.version));

    const latestPublished = versionRows.find(
      (v) => v.status === "PUBLISHED" && v.version === artifact.latestVersion,
    );

    const myRatingRows = await db
      .select({ stars: ratings.stars })
      .from(ratings)
      .where(and(eq(ratings.artifactId, artifact.id), eq(ratings.userId, user.id)))
      .limit(1);

    const forkRows = await db
      .select({ id: artifacts.id, name: artifacts.name })
      .from(artifacts)
      .where(eq(artifacts.forkedFromArtifactId, artifact.id))
      .orderBy(asc(artifacts.name));

    const detail: ArtifactDetail = {
      ...summary,
      versions: versionRows.map(versionSummary),
      contentPreview: latestPublished?.contentText ?? null,
      myRating: myRatingRows[0]?.stars ?? null,
      forks: forkRows,
    };
    return c.json(detail);
  });

  // ---- update metadata (owner only) ----
  app.patch("/:name", async (c) => {
    const artifact = await findArtifactByName(db, c.req.param("name"));
    if (!artifact) return c.json({ error: "not found" }, 404);
    if (artifact.ownerUserId !== c.get("user").id) {
      return c.json({ error: "only the owner can update an artifact" }, 403);
    }
    const body = updateArtifactSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return c.json({ error: "invalid request", details: body.error.flatten() }, 400);
    }
    if (body.data.description !== undefined) {
      await db
        .update(artifacts)
        .set({ description: body.data.description, updatedAt: new Date() })
        .where(eq(artifacts.id, artifact.id));
    }
    if (body.data.tags !== undefined) {
      await db.delete(artifactTags).where(eq(artifactTags.artifactId, artifact.id));
      for (const tag of new Set(body.data.tags)) {
        await db.insert(artifactTags).values({ artifactId: artifact.id, tag });
      }
    }
    return c.json({ ok: true });
  });

  // ---- publish a version ----
  app.post("/:name/versions", async (c) => {
    const body = publishVersionSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return c.json({ error: "invalid request", details: body.error.flatten() }, 400);
    }
    try {
      const result = await publishVersion({
        db,
        storage,
        maxZipBytes: config.maxZipBytes,
        artifactName: c.req.param("name"),
        callerUserId: c.get("user").id,
        stagingKey: body.data.stagingKey,
        message: body.data.message,
      });
      if (result.status === "BLOCKED") {
        return c.json(result, 422);
      }
      return c.json(result, 201);
    } catch (err) {
      if (err instanceof PublishError) {
        return c.json({ error: err.message, details: err.details ?? [] }, err.status);
      }
      throw err;
    }
  });

  // ---- versions ----
  app.get("/:name/versions", async (c) => {
    const artifact = await findArtifactByName(db, c.req.param("name"));
    if (!artifact) return c.json({ error: "not found" }, 404);
    const rows = await db
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, artifact.id))
      .orderBy(desc(artifactVersions.version));
    return c.json({ versions: rows.map(versionSummary) });
  });

  app.get("/:name/versions/:version", async (c) => {
    const artifact = await findArtifactByName(db, c.req.param("name"));
    if (!artifact) return c.json({ error: "not found" }, 404);
    const versionNumber = Number(c.req.param("version"));
    if (!Number.isInteger(versionNumber)) return c.json({ error: "invalid version" }, 400);
    const rows = await db
      .select()
      .from(artifactVersions)
      .where(
        and(
          eq(artifactVersions.artifactId, artifact.id),
          eq(artifactVersions.version, versionNumber),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return c.json({ error: "version not found" }, 404);

    const findings =
      row.status === "BLOCKED"
        ? await db.select().from(scanFindings).where(eq(scanFindings.versionId, row.id))
        : [];

    return c.json({
      ...versionSummary(row),
      fileList: row.fileList ? JSON.parse(row.fileList) : [],
      contentText: row.status === "PUBLISHED" ? row.contentText : null,
      findings: findings.map((f) => ({
        ruleId: f.ruleId,
        filePath: f.filePath,
        line: f.lineNumber,
        maskedMatch: f.maskedMatch,
        fingerprint: f.fingerprint,
      })),
    });
  });

  // ---- download (latest or specific version) ----
  const download = async (c: Context, versionNumber: number | undefined) => {
    const artifact = await findArtifactByName(db, c.req.param("name") ?? "");
    if (!artifact) return c.json({ error: "not found" }, 404);
    const row = await getPublishedVersion(db, artifact.id, versionNumber);
    if (!row || row.status !== "PUBLISHED" || !row.zipKey) {
      return c.json({ error: "no published version available" }, 404);
    }
    const client = c.req.query("client") === "cli" ? "cli" : "web";
    await db.insert(downloadEvents).values({
      id: randomUUID(),
      artifactId: artifact.id,
      versionId: row.id,
      userId: c.get("user").id,
      client,
    });
    const url = await storage.createDownloadUrl(row.zipKey, `${artifact.name}-v${row.version}.zip`);
    return c.json({
      url,
      fileName: `${artifact.name}-v${row.version}.zip`,
      version: row.version,
      type: artifact.type,
      name: artifact.name,
    });
  };

  app.get("/:name/download", (c) => download(c, undefined));
  app.get("/:name/versions/:version/download", (c) => {
    const versionNumber = Number(c.req.param("version"));
    if (!Number.isInteger(versionNumber)) return c.json({ error: "invalid version" }, 400);
    return download(c, versionNumber);
  });

  // ---- rating (upsert, one per user per artifact) ----
  app.put("/:name/rating", async (c) => {
    const artifact = await findArtifactByName(db, c.req.param("name"));
    if (!artifact) return c.json({ error: "not found" }, 404);
    const body = ratingSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return c.json({ error: "invalid request", details: body.error.flatten() }, 400);
    }
    const user = c.get("user");
    const updated = await db
      .update(ratings)
      .set({ stars: body.data.stars, updatedAt: new Date() })
      .where(and(eq(ratings.artifactId, artifact.id), eq(ratings.userId, user.id)))
      .returning({ id: ratings.id });
    if (updated.length === 0) {
      await db.insert(ratings).values({
        id: randomUUID(),
        artifactId: artifact.id,
        userId: user.id,
        stars: body.data.stars,
      });
    }
    return c.json({ ok: true, stars: body.data.stars });
  });

  // ---- scan overrides (owner only) ----
  app.post("/:name/scan-overrides", async (c) => {
    const artifact = await findArtifactByName(db, c.req.param("name"));
    if (!artifact) return c.json({ error: "not found" }, 404);
    if (artifact.ownerUserId !== c.get("user").id) {
      return c.json({ error: "only the owner can override findings" }, 403);
    }
    const body = scanOverrideSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return c.json({ error: "invalid request", details: body.error.flatten() }, 400);
    }
    const existing = await db
      .select({ id: scanOverrides.id })
      .from(scanOverrides)
      .where(
        and(
          eq(scanOverrides.artifactId, artifact.id),
          eq(scanOverrides.fingerprint, body.data.fingerprint),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      await db.insert(scanOverrides).values({
        id: randomUUID(),
        artifactId: artifact.id,
        fingerprint: body.data.fingerprint,
        reason: body.data.reason,
        createdBy: c.get("user").id,
      });
    }
    return c.json({ ok: true }, 201);
  });

  return app;
}
