"use client";

import Link from "next/link";
import type { ArtifactSummary } from "@skill-book/shared";
import { StarRating } from "./StarRating";

export function ArtifactCard({ artifact }: { artifact: ArtifactSummary }) {
  return (
    <div className="card artifact-card" data-testid={`artifact-card-${artifact.name}`}>
      <h3>
        <Link href={`/artifact/?name=${encodeURIComponent(artifact.name)}`}>{artifact.name}</Link>{" "}
        <span className={`badge type-${artifact.type}`}>{artifact.type}</span>
      </h3>
      <p className="desc">{artifact.description || "(no description)"}</p>
      <div>
        {artifact.tags.map((tag) => (
          <span key={tag} className="tag-chip">
            {tag}
          </span>
        ))}
      </div>
      <div className="meta">
        <StarRating value={artifact.ratingAverage} readonly />
        <span>({artifact.ratingCount})</span>
        <span>⬇ {artifact.downloadCount}</span>
        <span>v{artifact.latestVersion ?? "—"}</span>
        <span>by {artifact.ownerDisplayName ?? "unknown"}</span>
        {artifact.forkedFromName && <span>⑂ fork of {artifact.forkedFromName}</span>}
      </div>
    </div>
  );
}
