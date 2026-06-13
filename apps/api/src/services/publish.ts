import { randomUUID } from "node:crypto";
import { and, eq, max } from "drizzle-orm";
import type { ArtifactType, PublishResult, ScanFinding } from "@skill-book/shared";
import { isProbablyBinary, scanFiles } from "@skill-book/shared/scanner";
import { buildContentText, validateArtifact } from "@skill-book/shared/validators";
import { createZip, safeUnzip, ZipSafetyError } from "@skill-book/shared/zip";
import type { Db } from "../db/client.js";
import { artifacts, artifactVersions, scanFindings, scanOverrides } from "../db/schema.js";
import { ObjectNotFoundError, type Storage } from "../storage/index.js";

const decoder = new TextDecoder();

export class PublishError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 413 | 422,
    message: string,
    public readonly details?: string[],
  ) {
    super(message);
    this.name = "PublishError";
  }
}

export interface PublishParams {
  db: Db;
  storage: Storage;
  maxZipBytes: number;
  artifactName: string;
  callerUserId: string;
  stagingKey: string;
  message?: string;
}

export async function publishVersion(params: PublishParams): Promise<PublishResult> {
  const { db, storage, artifactName, callerUserId, stagingKey } = params;

  const artifactRows = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.name, artifactName))
    .limit(1);
  const artifact = artifactRows[0];
  if (!artifact) {
    throw new PublishError(404, `artifact not found: ${artifactName}`);
  }
  if (artifact.ownerUserId !== callerUserId) {
    throw new PublishError(403, "only the artifact owner can publish new versions");
  }
  if (!stagingKey.startsWith(`staging/${callerUserId}/`)) {
    throw new PublishError(403, "stagingKey does not belong to the caller");
  }

  let size: number;
  try {
    size = await storage.getObjectSize(stagingKey);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      throw new PublishError(404, "staged upload not found (it may have expired)");
    }
    throw err;
  }
  if (size > params.maxZipBytes) {
    throw new PublishError(413, `staged zip exceeds ${params.maxZipBytes} bytes`);
  }

  // Allocate the next version number and record the attempt as SCANNING.
  const maxRows = await db
    .select({ value: max(artifactVersions.version) })
    .from(artifactVersions)
    .where(eq(artifactVersions.artifactId, artifact.id));
  const version = (maxRows[0]?.value ?? 0) + 1;
  const versionId = randomUUID();
  await db.insert(artifactVersions).values({
    id: versionId,
    artifactId: artifact.id,
    version,
    status: "SCANNING",
    message: params.message ?? null,
    createdBy: callerUserId,
  });

  const fail = async (status: 400 | 422, message: string, details?: string[]) => {
    await db.delete(artifactVersions).where(eq(artifactVersions.id, versionId));
    await storage.deleteObject(stagingKey).catch(() => {});
    return new PublishError(status, message, details);
  };

  const zipData = await storage.getObject(stagingKey);
  let entries;
  try {
    entries = safeUnzip(zipData);
  } catch (err) {
    if (err instanceof ZipSafetyError) {
      throw await fail(400, "invalid or unsafe zip archive", [err.message]);
    }
    throw err;
  }

  const validation = validateArtifact(artifact.type as ArtifactType, entries, artifact.name);
  if (!validation.ok) {
    throw await fail(422, "artifact validation failed", validation.errors);
  }
  const normalized = validation.entries;

  // Secrets scan over text entries, minus accepted overrides for this artifact.
  const textFiles = normalized
    .filter((e) => !isProbablyBinary(e.data))
    .map((e) => ({ path: e.path, text: decoder.decode(e.data) }));
  const overrides = await db
    .select({ fingerprint: scanOverrides.fingerprint })
    .from(scanOverrides)
    .where(eq(scanOverrides.artifactId, artifact.id));
  const overridden = new Set(overrides.map((o) => o.fingerprint));
  const findings: ScanFinding[] = scanFiles(textFiles).filter(
    (f) => !overridden.has(f.fingerprint),
  );

  if (findings.length > 0) {
    for (const finding of findings) {
      await db.insert(scanFindings).values({
        id: randomUUID(),
        versionId,
        ruleId: finding.ruleId,
        filePath: finding.filePath,
        lineNumber: finding.line,
        fingerprint: finding.fingerprint,
        maskedMatch: finding.maskedMatch,
      });
    }
    await db
      .update(artifactVersions)
      .set({ status: "BLOCKED" })
      .where(eq(artifactVersions.id, versionId));
    await storage.deleteObject(stagingKey).catch(() => {});
    return { status: "BLOCKED", artifactId: artifact.id, versionId, version, findings };
  }

  // Clean: write the canonical zip and publish.
  const canonicalZip = createZip(normalized);
  const zipKey = `artifacts/${artifact.id}/${version}/artifact.zip`;
  await storage.putObject(zipKey, canonicalZip, "application/zip");

  const totalSizeBytes = normalized.reduce((sum, e) => sum + e.data.length, 0);
  await db
    .update(artifactVersions)
    .set({
      status: "PUBLISHED",
      zipKey,
      contentText: buildContentText(normalized),
      fileList: JSON.stringify(normalized.map((e) => ({ path: e.path, size: e.data.length }))),
      totalSizeBytes,
      fileCount: normalized.length,
      publishedAt: new Date(),
    })
    .where(eq(artifactVersions.id, versionId));
  await db
    .update(artifacts)
    .set({ latestVersion: version, updatedAt: new Date() })
    .where(eq(artifacts.id, artifact.id));
  await storage.deleteObject(stagingKey).catch(() => {});

  return { status: "PUBLISHED", artifactId: artifact.id, versionId, version };
}

export async function getPublishedVersion(db: Db, artifactId: string, version?: number) {
  if (version != null) {
    const rows = await db
      .select()
      .from(artifactVersions)
      .where(
        and(eq(artifactVersions.artifactId, artifactId), eq(artifactVersions.version, version)),
      )
      .limit(1);
    return rows[0];
  }
  const artifactRows = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, artifactId))
    .limit(1);
  const latest = artifactRows[0]?.latestVersion;
  if (latest == null) return undefined;
  const rows = await db
    .select()
    .from(artifactVersions)
    .where(and(eq(artifactVersions.artifactId, artifactId), eq(artifactVersions.version, latest)))
    .limit(1);
  return rows[0];
}
