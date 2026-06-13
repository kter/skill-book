import { avg, count, desc, eq, inArray } from "drizzle-orm";
import type { ArtifactSummary, ArtifactType } from "@skill-book/shared";
import type { Db } from "../db/client.js";
import { artifacts, artifactTags, downloadEvents, ratings, users } from "../db/schema.js";

type ArtifactRow = typeof artifacts.$inferSelect;

export interface ArtifactAggregates {
  tags: Map<string, string[]>;
  downloads: Map<string, number>;
  ratingAvg: Map<string, number>;
  ratingCount: Map<string, number>;
  ownerNames: Map<string, string | null>;
  forkSourceNames: Map<string, string>;
}

export async function loadAggregates(db: Db, rows: ArtifactRow[]): Promise<ArtifactAggregates> {
  const ids = rows.map((r) => r.id);
  const aggregates: ArtifactAggregates = {
    tags: new Map(),
    downloads: new Map(),
    ratingAvg: new Map(),
    ratingCount: new Map(),
    ownerNames: new Map(),
    forkSourceNames: new Map(),
  };
  if (ids.length === 0) return aggregates;

  const tagRows = await db.select().from(artifactTags).where(inArray(artifactTags.artifactId, ids));
  for (const row of tagRows) {
    const list = aggregates.tags.get(row.artifactId) ?? [];
    list.push(row.tag);
    aggregates.tags.set(row.artifactId, list.sort());
  }

  const downloadRows = await db
    .select({ artifactId: downloadEvents.artifactId, n: count() })
    .from(downloadEvents)
    .where(inArray(downloadEvents.artifactId, ids))
    .groupBy(downloadEvents.artifactId);
  for (const row of downloadRows) {
    aggregates.downloads.set(row.artifactId, Number(row.n));
  }

  const ratingRows = await db
    .select({ artifactId: ratings.artifactId, average: avg(ratings.stars), n: count() })
    .from(ratings)
    .where(inArray(ratings.artifactId, ids))
    .groupBy(ratings.artifactId);
  for (const row of ratingRows) {
    aggregates.ratingAvg.set(row.artifactId, Number(row.average));
    aggregates.ratingCount.set(row.artifactId, Number(row.n));
  }

  const ownerIds = [...new Set(rows.map((r) => r.ownerUserId))];
  const ownerRows = await db.select().from(users).where(inArray(users.id, ownerIds));
  for (const row of ownerRows) {
    aggregates.ownerNames.set(row.id, row.displayName);
  }

  const forkSourceIds = [
    ...new Set(rows.map((r) => r.forkedFromArtifactId).filter((v): v is string => Boolean(v))),
  ];
  if (forkSourceIds.length > 0) {
    const sourceRows = await db
      .select({ id: artifacts.id, name: artifacts.name })
      .from(artifacts)
      .where(inArray(artifacts.id, forkSourceIds));
    for (const row of sourceRows) {
      aggregates.forkSourceNames.set(row.id, row.name);
    }
  }

  return aggregates;
}

export function toSummary(row: ArtifactRow, agg: ArtifactAggregates): ArtifactSummary {
  return {
    id: row.id,
    name: row.name,
    type: row.type as ArtifactType,
    description: row.description,
    tags: agg.tags.get(row.id) ?? [],
    ownerUserId: row.ownerUserId,
    ownerDisplayName: agg.ownerNames.get(row.ownerUserId) ?? null,
    forkedFromArtifactId: row.forkedFromArtifactId,
    forkedFromName: row.forkedFromArtifactId
      ? (agg.forkSourceNames.get(row.forkedFromArtifactId) ?? null)
      : null,
    latestVersion: row.latestVersion,
    downloadCount: agg.downloads.get(row.id) ?? 0,
    ratingAverage: agg.ratingAvg.get(row.id) ?? null,
    ratingCount: agg.ratingCount.get(row.id) ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listArtifactRows(db: Db): Promise<ArtifactRow[]> {
  return db.select().from(artifacts).orderBy(desc(artifacts.updatedAt));
}

export async function findArtifactByName(db: Db, name: string): Promise<ArtifactRow | undefined> {
  const rows = await db.select().from(artifacts).where(eq(artifacts.name, name)).limit(1);
  return rows[0];
}
