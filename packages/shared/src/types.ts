export const ARTIFACT_TYPES = ["CLAUDE_SKILL", "CLAUDE_MD", "AGENTS_MD"] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const VERSION_STATUSES = ["SCANNING", "BLOCKED", "PUBLISHED"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export interface ScanFinding {
  ruleId: string;
  filePath: string;
  line: number;
  maskedMatch: string;
  fingerprint: string;
}

export interface ArtifactSummary {
  id: string;
  name: string;
  type: ArtifactType;
  description: string;
  tags: string[];
  ownerUserId: string;
  ownerDisplayName: string | null;
  forkedFromArtifactId: string | null;
  forkedFromName: string | null;
  latestVersion: number | null;
  downloadCount: number;
  ratingAverage: number | null;
  ratingCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactVersionSummary {
  id: string;
  artifactId: string;
  version: number;
  status: VersionStatus;
  totalSizeBytes: number;
  fileCount: number;
  message: string | null;
  /** AI-generated summary of this version's content (null if unavailable). */
  explanation: string | null;
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
}

export interface ArtifactDetail extends ArtifactSummary {
  versions: ArtifactVersionSummary[];
  contentPreview: string | null;
  /** AI-generated summary of the latest published version's content (null if unavailable). */
  explanation: string | null;
  myRating: number | null;
  forks: { id: string; name: string }[];
}

export interface PublishResultPublished {
  status: "PUBLISHED";
  artifactId: string;
  versionId: string;
  version: number;
}

export interface PublishResultBlocked {
  status: "BLOCKED";
  artifactId: string;
  versionId: string;
  version: number;
  findings: ScanFinding[];
}

export type PublishResult = PublishResultPublished | PublishResultBlocked;

/** Display name of an artifact type, used by web and CLI. */
export function artifactTypeLabel(type: ArtifactType): string {
  switch (type) {
    case "CLAUDE_SKILL":
      return "Claude Skill";
    case "CLAUDE_MD":
      return "CLAUDE.md";
    case "AGENTS_MD":
      return "AGENTS.md";
  }
}
